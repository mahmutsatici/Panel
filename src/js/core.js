// Ortak yardımcılar ve paylaşılan durum. Diğer js/*.js dosyaları bunları kullanır.
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const api = window.panel;

// Uygulama dosyalarının adresi. Notlardaki göreli resimler için sayfaya <base> eklendiğinde
// kendi dosyalarımızı (simgeler vb.) bu adrese göre çözüyoruz.
const APP_BASE = document.baseURI;
const appUrl = rel => new URL(rel, APP_BASE).href;

marked.setOptions({ gfm: true, breaks: true });
const renderInline = md => DOMPurify.sanitize(marked.parseInline(md));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const lower = s => String(s).toLocaleLowerCase('tr');
// Electron, ana süreçte fırlatılan hataları "Error invoking remote method '...': Error: ..." diye
// sarmalıyor; kullanıcıya sadece asıl mesajı göstermek için bu sarmalamayı temizler.
const cleanErr = e => String(e?.message || e).replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '');
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// Metin içinde aramayı <mark> ile vurgula (Türkçe büyük/küçük harf duyarsız)
function highlight(text, q) {
  if (!q) return esc(text);
  const lt = lower(text), lq = lower(q);
  let out = '', i = 0, j;
  while ((j = lt.indexOf(lq, i)) !== -1) {
    out += esc(text.slice(i, j)) + '<mark>' + esc(text.slice(j, j + q.length)) + '</mark>';
    i = j + q.length;
  }
  return out + esc(text.slice(i));
}

// --- Tarih yardımcıları (hepsi yerel saat) ---
const todayISO = () => new Date().toLocaleDateString('sv-SE');              // 2026-10-05
const stampNow = () => new Date().toLocaleString('sv-SE').slice(0, 16).replace(' ', 'T'); // 2026-10-05T15:40
const parseISODate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const isoOf = d => d.toLocaleDateString('sv-SE');
const dayDiff = iso => Math.round((parseISODate(iso) - parseISODate(todayISO())) / 864e5);
const fmtDayMonth = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' });
const fmtDayMonthYear = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtLongDay = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' });
const fmtStamp = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtStampStr = s => { const d = new Date(s); return isNaN(d) ? s : fmtStamp.format(d); };

// Son tarih etiketi: Bugün / Yarın / Dün / 12 Eki; ve durum sınıfı
function dueInfo(iso, done) {
  const diff = dayDiff(iso);
  const d = parseISODate(iso);
  let label = diff === 0 ? 'Bugün' : diff === 1 ? 'Yarın' : diff === -1 ? 'Dün'
    : (d.getFullYear() === new Date().getFullYear() ? fmtDayMonth : fmtDayMonthYear).format(d);
  let cls = 'future', title = diff > 0 ? `${diff} gün kaldı` : 'Bugün';
  if (!done && diff < 0) { cls = 'overdue'; title = `${-diff} gün gecikti`; }
  else if (!done && diff === 0) cls = 'today';
  if (done) cls = 'done';
  return { label, cls, title: `Son tarih: ${fmtDayMonthYear.format(d)} · ${title}` };
}

const addDays = (iso, n) => { const d = parseISODate(iso); d.setDate(d.getDate() + n); return isoOf(d); };
const addMonths = (iso, n) => {
  const d = parseISODate(iso), day = d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  t.setDate(Math.min(day, new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()));
  return isoOf(t);
};

// ============ Tekrarlayan görevler ============
// Görev satırında "🔁 her hafta" gibi durur. Tamamlanınca bir sonraki tarihle yeni bir kopyası oluşur.
const REC_PRESETS = [
  ['her gün', 'Her gün'], ['hafta içi', 'Hafta içi'], ['her hafta', 'Her hafta'],
  ['her 2 hafta', '2 haftada bir'], ['her ay', 'Her ay'], ['her yıl', 'Her yıl'],
];
const REC_RULE_RE = /^(?:her\s+(?:(\d+)\s+)?(gün|hafta|ay|yıl)|hafta\s*içi|her\s+iş\s+günü)$/u;
const normalizeRec = s => { const r = lower(String(s || '')).replace(/\s+/g, ' ').trim(); return REC_RULE_RE.test(r) ? r : null; };
const recLabel = r => (REC_PRESETS.find(([k]) => k === r) || [, r.charAt(0).toLocaleUpperCase('tr') + r.slice(1)])[1];
function nextRecDate(rule, fromIso) {
  const m = rule.match(REC_RULE_RE);
  const step = iso => {
    if (!m[2]) { // hafta içi / her iş günü
      let d = addDays(iso, 1);
      while ([0, 6].includes(parseISODate(d).getDay())) d = addDays(d, 1);
      return d;
    }
    const n = Number(m[1] || 1);
    return { gün: () => addDays(iso, n), hafta: () => addDays(iso, 7 * n), ay: () => addMonths(iso, n), yıl: () => addMonths(iso, 12 * n) }[m[2]]();
  };
  // Geç tamamlanan görevin bir sonraki tarihi geçmişte kalmasın
  let next = step(fromIso || todayISO());
  for (let i = 0; i < 1000 && next < todayISO(); i++) next = step(next);
  return next;
}

// ============ Doğal dilde tarih ============
// Görev metninin başında ya da sonunda yazılan ifadeleri son tarihe / tekrara çevirir:
//   "rapor yaz yarın", "cuma toplantı", "kira öde 15 ekim", "spor her gün", "3 gün sonra fatura"
const TR_MONTHS = ['ocak', 'şubat', 'mart', 'nisan', 'mayıs', 'haziran', 'temmuz', 'ağustos', 'eylül', 'ekim', 'kasım', 'aralık'];
const TR_WEEKDAYS = [['pazartesi', 1], ['salı', 2], ['çarşamba', 3], ['perşembe', 4], ['cumartesi', 6], ['cuma', 5], ['pazar', 0]];
const SFX = "(?:'?(?:ya|ye|a|e|ne|na|ki|den|dan|de|da|e kadar|a kadar|ye kadar|ya kadar))?";
const NL_DATE_RULES = [
  [`bugün${SFX}`, () => todayISO()],
  [`yarın${SFX}`, () => addDays(todayISO(), 1)],
  [`(?:öbür ?gün|ertesi gün)${SFX}`, () => addDays(todayISO(), 2)],
  [`(?:haftaya|gelecek hafta|önümüzdeki hafta)`, () => addDays(todayISO(), 7)],
  [`hafta ?sonu${SFX}`, () => { let d = addDays(todayISO(), 1); while (parseISODate(d).getDay() !== 6) d = addDays(d, 1); return d; }],
  [`ay ?sonu${SFX}`, () => { const t = new Date(); return isoOf(new Date(t.getFullYear(), t.getMonth() + 1, 0)); }],
  ['(\\d+) (gün|hafta|ay) sonra', (n, u) => u === 'ay' ? addMonths(todayISO(), +n) : addDays(todayISO(), +n * (u === 'hafta' ? 7 : 1))],
  ...TR_WEEKDAYS.map(([w, wd]) => [`${w}${SFX}`, () => {
    // Bir sonraki o gün (bugün o günse gelecek haftaki)
    let d = addDays(todayISO(), 1);
    while (parseISODate(d).getDay() !== wd) d = addDays(d, 1);
    return d;
  }]),
  [`(\\d{1,2}) (${TR_MONTHS.join('|')})(?: (\\d{4}))?${SFX}`, (d, mon, y) => explicitDate(+d, TR_MONTHS.indexOf(mon), y)],
  ['(\\d{1,2})[./](\\d{1,2})(?:[./](\\d{4}))?', (d, m, y) => explicitDate(+d, +m - 1, y)],
];
function explicitDate(day, month, year) {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const now = new Date();
  let d = new Date(year ? +year : now.getFullYear(), month, day);
  if (d.getMonth() !== month) return null;               // 31 şubat gibi geçersiz
  if (!year && isoOf(d) < todayISO()) d = new Date(now.getFullYear() + 1, month, day); // geçtiyse seneye
  return isoOf(d);
}
const NL_REC_RE = '(her (?:\\d+ )?(?:gün|hafta|ay|yıl)|hafta ?içi|her iş günü)';
// "15:30", "saat 15:30", "saat 9", "15:30'da" → "HH:MM"
const NL_TIME_RE = `(?:saat ?)?(\\d{1,2}):(\\d{2})${SFX}|saat ?(\\d{1,2})${SFX}`;
const toTime = (h, m = '0') => (+h < 24 && +m < 60 ? `${String(+h).padStart(2, '0')}:${String(+m).padStart(2, '0')}` : null);

// Metnin başında/sonunda bir ifade ara; bulunursa { value, text: ifade çıkarılmış metin }
function takePhrase(text, pattern, convert) {
  const low = lower(text);
  for (const re of [new RegExp(`(?:^|\\s)(?:${pattern})$`, 'u'), new RegExp(`^(?:${pattern})(?=\\s|$)`, 'u')]) {
    const m = low.match(re);
    if (!m) continue;
    const value = convert(...m.slice(1));
    if (!value) continue;
    const rest = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    if (rest) return { value, text: rest };
  }
  return null;
}
function parseNatural(input) {
  let text = input.trim(), due = null, rec = null, time = null;
  const r = takePhrase(text, NL_REC_RE, s => normalizeRec(s.replace('haftaiçi', 'hafta içi')));
  if (r) { rec = r.value; text = r.text; }
  const tm = takePhrase(text, NL_TIME_RE, (h1, m1, h2) => toTime(h1 ?? h2, m1));
  if (tm) { time = tm.value; text = tm.text; }
  for (const [pattern, fn] of NL_DATE_RULES) {
    const d = takePhrase(text, pattern, fn);
    if (d) { due = d.value; text = d.text; break; }
  }
  return { text, due, rec, time };
}

// ============ Hatırlatıcılar (biçim) ============
// Görevin hatırlatıcıları (task.remind) metin parçalarıdır: "15dk" = görev saatinden 15 dakika önce ("0dk" = tam saatinde),
// "2026-11-05T09:00" = o anda. Dosyada "🔔 0dk,15dk" biçiminde yazılır.
const REMIND_RE = /^(?:\d+dk|\d{4}-\d{2}-\d{2}T\d{2}:\d{2})$/;
const isRelRemind = tok => tok.endsWith('dk');
const REMIND_PRESETS = [[0, 'Saatinde'], [15, '15 dk önce'], [60, '1 sa önce'], [1440, '1 gün önce']];
function remindLabel(tok) {
  if (!isRelRemind(tok)) { const d = new Date(tok); return isNaN(d) ? tok : `${fmtDayMonth.format(d)} ${tok.slice(11)}`; }
  const n = parseInt(tok, 10);
  if (!n) return 'Saatinde';
  return n % 1440 === 0 ? `${n / 1440} gün önce` : n % 60 === 0 ? `${n / 60} sa önce` : `${n} dk önce`;
}
// Hatırlatıcının çalacağı an (Date); göreli olup görevin günü/saati yoksa null
function remindAt(task, tok) {
  if (!isRelRemind(tok)) return new Date(tok);
  if (!task.due || !task.time) return null;
  return new Date(parseISODate(task.due).getTime() + (+task.time.slice(0, 2) * 60 + +task.time.slice(3)) * 6e4 - parseInt(tok, 10) * 6e4);
}

// ============ Tarih penceresi ============
// Görev son tarihi, saati, hatırlatıcıları ve tekrarı için ortak açılır pencere: yazarak tarih, hızlı günler,
// ortada değişen bir gövde (ay görünümü / saat listesi / hatırlatıcı / tekrar) ve altta bu değerlerin çipleri.
// onChange({ due, rec, time, remind }) ile her değişimde bildirir.
const datePop = document.getElementById('datePop');
let datePopState = null;
function pickDate(anchor, { due = null, rec = null, time = null, remind = [], allowRec = true, allowTime = true } = {}, onChange, onClose) {
  const base = due || todayISO();
  // view: gövdede ne görünüyor ('cal' | 'time' | 'remind' | 'rec'); keep: kullanıcı ayrıntı ayarlamaya başladıysa gün seçimi pencereyi kapatmaz
  datePopState = { anchor, due, rec, time, remind: [...remind], allowRec, allowTime, view: 'cal', keep: false, onChange, onClose, month: new Date(parseISODate(base).getFullYear(), parseISODate(base).getMonth(), 1) };
  renderDatePop();
  datePop.hidden = false;
  positionDatePop();
}
function closeDatePop() {
  const onClose = datePopState?.onClose;
  datePop.hidden = true;
  datePopState = null;
  onClose?.();   // ör. yeni görev satırı yazma odağını geri alır
}
function positionDatePop() {
  // Bağlı düğme liste yeniden çizilince kaybolabilir (ör. gün penceresindeki saat düğmesi); o zaman son bilinen konum kullanılır
  const s = datePopState;
  if (s.anchor.isConnected) s.rect = s.anchor.getBoundingClientRect();
  const r = s.rect;
  const w = datePop.offsetWidth, h = datePop.offsetHeight;
  datePop.style.left = `${Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8)}px`;
  const top = r.bottom + 6 + h > innerHeight - 8 ? r.top - h - 6 : r.bottom + 6;
  datePop.style.top = `${Math.max(8, Math.min(top, innerHeight - h - 8))}px`;   // her durumda ekranda kalsın
}
function commitDate(patch, close) {
  const s = datePopState;
  Object.assign(s, patch);
  if (!s.due) { s.time = null; s.remind = s.remind.filter(t => !isRelRemind(t)); }   // saat ve göreli hatırlatıcı bir güne bağlıdır
  s.onChange({ due: s.due, rec: s.rec, time: s.time, remind: s.remind });
  // Liste yeniden çizilince bağlı düğme yok olabilir; o zaman pencere olduğu yerde kalsın
  if (close) closeDatePop(); else { renderDatePop(); positionDatePop(); }
}
// ---- Açılır liste (select yerine): uygulamanın kendi tasarımında seçenek listesi ----
// openListPop(anchor, [{value, label}], current, onPick): düğmenin altında (yer yoksa üstünde) açılır; seçili olan ✓ ile işaretlenir.
const listPop = document.createElement('div');
listPop.className = 'list-pop';
listPop.hidden = true;
document.body.append(listPop);
let listPopAnchor = null;
function closeListPop() { listPop.hidden = true; listPopAnchor = null; }
function openListPop(anchor, items, current, onPick) {
  listPopAnchor = anchor;
  listPop.innerHTML = items.map((o, i) => `<button type="button" data-i="${i}" class="${String(o.value) === String(current) ? 'on' : ''}"><span>${esc(o.label)}</span>${String(o.value) === String(current) ? ico('check') : ''}</button>`).join('');
  listPop.querySelectorAll('button').forEach(b => b.onclick = () => { closeListPop(); onPick(items[+b.dataset.i].value); });
  // Modal pencere (dialog) üst katmandadır: liste de onun içine alınmazsa altında kalır
  const host = anchor.closest('dialog[open]') || document.body;
  if (listPop.parentElement !== host) host.append(listPop);
  listPop.hidden = false;
  const r = anchor.getBoundingClientRect();
  listPop.style.minWidth = `${Math.max(r.width, 140)}px`;
  const w = listPop.offsetWidth, h = listPop.offsetHeight;
  listPop.style.left = `${Math.min(Math.max(8, r.left), innerWidth - w - 8)}px`;
  listPop.style.top = `${Math.max(8, r.bottom + 4 + h > innerHeight - 8 ? r.top - h - 4 : r.bottom + 4)}px`;
  listPop.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
}
document.addEventListener('mousedown', e => { if (!listPop.hidden && !e.target.closest('.list-pop') && !listPopAnchor?.contains(e.target)) closeListPop(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !listPop.hidden) { closeListPop(); e.stopPropagation(); } }, true);
// Yerel <select>'i gizleyip yerine düğme + özel liste koyar; select.value ve "change" olayı aynen çalışır
function enhanceSelect(sel) {
  if (sel._enh) return;
  sel._enh = true;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sel-btn';
  btn.title = sel.title || '';
  sel.after(btn);
  sel.style.display = 'none';
  const label = () => { const o = sel.options[sel.selectedIndex]; btn.innerHTML = `<span>${esc(o ? o.textContent : '')}</span>${ico('chev-d')}`; };
  const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(sel, 'value', { get() { return desc.get.call(this); }, set(v) { desc.set.call(this, v); label(); } });   // kodla değer atanınca etiket güncellensin
  sel.addEventListener('change', label);
  new MutationObserver(label).observe(sel, { childList: true });   // seçenekler sonradan eklenirse (ör. ses listesi)
  btn.onclick = () => {
    if (listPopAnchor === btn && !listPop.hidden) return closeListPop();
    openListPop(btn, [...sel.options].map(o => ({ value: o.value, label: o.textContent })), sel.value, v => { sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })); });
  };
  label();
}

// Yerel <datalist> önerileri yerine aynı özel liste (giriş kutusuna tıklayınca açılır)
function enhanceDatalist(input) {
  const opts = [...document.querySelectorAll(`#${input.getAttribute('list')} option`)].map(o => ({ value: o.value, label: o.value }));
  input.removeAttribute('list');
  const open = () => openListPop(input, opts, input.value, v => { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); });
  input.addEventListener('focus', open);
  input.addEventListener('click', () => { if (listPop.hidden) open(); });
}

// ---- Saat seçici: 15 dakikalık adımlarla kaydırılabilir liste (her satır bir saat: SS:00 SS:15 SS:30 SS:45) ----
const TIME_MINS = ['00', '15', '30', '45'];
const timeOpts = Array.from({ length: 96 }, (_, i) => `${String(i >> 2).padStart(2, '0')}:${TIME_MINS[i & 3]}`);
function timeListHtml(value) {
  const rows = Array.from({ length: 24 }, (_, h) => `<div class="tl-row">${timeOpts.slice(h * 4, h * 4 + 4)
    .map(t => `<button type="button" data-t="${t}" class="${t === value ? 'on' : ''}">${t}</button>`).join('')}</div>`).join('');
  return `<div class="tl">${rows}</div>`;
}
// Düğmeleri bağlar ve listeyi seçili saate (yoksa 09:00'a) kaydırır; liste görünür olduktan sonra çağrılmalı
function bindTimeList(root, value, onPick) {
  const list = root.querySelector('.tl');
  list.querySelectorAll('[data-t]').forEach(b => b.onclick = () => onPick(b.dataset.t));
  const row = list.children[value ? +value.slice(0, 2) : 9];
  list.scrollTop = row.offsetTop - (list.clientHeight - row.offsetHeight) / 2;
}
// Tek başına açılan saat penceresi (gün penceresindeki "Saat" düğmesi için)
const timePop = document.getElementById('timePop');
let timePopAnchor = null;
function closeTimePop() { timePop.hidden = true; timePopAnchor = null; }
function pickTime(anchor, value, onPick) {
  timePopAnchor = anchor;
  timePop.innerHTML = `<div class="tp-h">${ico('clock')}<b>Saat</b><button type="button" class="dp-clear${value ? '' : ' on'}" data-none>Saatsiz</button></div>${timeListHtml(value)}`;
  timePop.querySelector('[data-none]').onclick = () => { onPick(null); closeTimePop(); };
  timePop.hidden = false;
  bindTimeList(timePop, value, t => { onPick(t); closeTimePop(); });
  const r = anchor.getBoundingClientRect(), w = timePop.offsetWidth, h = timePop.offsetHeight;
  timePop.style.left = `${Math.min(Math.max(8, r.left), innerWidth - w - 8)}px`;
  timePop.style.top = `${Math.max(8, r.bottom + 6 + h > innerHeight - 8 ? r.top - h - 6 : r.bottom + 6)}px`;
}
document.addEventListener('mousedown', e => { if (!timePop.hidden && !e.target.closest('#timePop') && !timePopAnchor?.contains(e.target)) closeTimePop(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeTimePop(); });

function renderDatePop() {
  const s = datePopState, today = todayISO();
  const customRem = s.remind.filter(t => !REMIND_PRESETS.some(([n]) => n + 'dk' === t));
  // Gövde başlığı (ay görünümü dışındaki bölümler): geri + başlık + sağda isteğe bağlı düğme
  const paneHead = (icon, title, extra = '') => `<div class="dp-pane-h"><button type="button" class="dp-nav" data-view="cal" title="Takvime dön">${ico('chev-l')}</button>${ico(icon)}<b>${title}</b>${extra}</div>`;
  let body;
  if (s.view === 'time') {
    body = paneHead('clock', 'Saat', `<button type="button" class="dp-clear${s.time ? '' : ' on'}" data-time-none>Saatsiz</button>`) + timeListHtml(s.time);
  } else if (s.view === 'remind') {
    body = `${paneHead('bell', 'Hatırlatıcı')}
      <div class="dp-sub">Görev saatine göre${s.time ? ` <span>(${s.time})</span>` : ''}</div>
      <div class="dp-chips">${REMIND_PRESETS.map(([n, l]) => `<button type="button" data-remind="${n}dk" class="${s.remind.includes(n + 'dk') ? 'on' : ''}" ${s.time ? '' : 'disabled'}>${s.remind.includes(n + 'dk') ? ico('check') : ''}${l}</button>`).join('')}</div>
      ${s.time ? '' : '<p class="dp-hint">Bu seçenekler için görevin saati olmalı. <button type="button" class="dp-link" data-view="time">Saat seç</button></p>'}
      <div class="dp-sub">Belirli zaman</div>
      <div class="dp-radd-row"><button type="button" class="dp-rd-btn" aria-label="Hatırlatma günü">${ico('calendar')}<span>${fmtShortDay.format(parseISODate(s.remDate || s.due || today))}</span>${ico('chev-d')}</button>
        <button type="button" class="dp-rt-btn" aria-label="Hatırlatma saati">${ico('clock')}<span>${s.remTime || (s.time && timeOpts.includes(s.time) ? s.time : '09:00')}</span>${ico('chev-d')}</button>
        <button type="button" class="dp-radd" title="Hatırlatıcı ekle">${ico('plus')}Ekle</button></div>
      ${customRem.length ? `<div class="dp-chips">${customRem.map(t => `<span class="dp-tok">${esc(remindLabel(t))}<button type="button" data-remind="${t}" title="Kaldır" aria-label="Kaldır">${ico('x')}</button></span>`).join('')}</div>` : ''}`;
  } else if (s.view === 'rec') {
    const custom = s.rec && !REC_PRESETS.some(([k]) => k === s.rec);
    body = `${paneHead('repeat', 'Tekrar')}
      <div class="dp-chips dp-rec-chips"><button type="button" data-rec="" class="${s.rec ? '' : 'on'}">Tekrar yok</button>
      ${REC_PRESETS.map(([k, l]) => `<button type="button" data-rec="${k}" class="${s.rec === k ? 'on' : ''}">${s.rec === k ? ico('check') : ''}${l}</button>`).join('')}
      ${custom ? `<button type="button" data-rec="${esc(s.rec)}" class="on">${ico('check')}${esc(recLabel(s.rec))}</button>` : ''}</div>
      <p class="dp-hint">Tamamlanınca görev bir sonraki tarihle yeniden oluşur.</p>`;
  } else {
    // Ay görünümü: yükseklik sabit kalsın diye her zaman 6 hafta
    const m = s.month, offset = (m.getDay() + 6) % 7;
    let days = WEEKDAY_SHORT.map(w => `<span class="dp-wd">${w}</span>`).join('');
    for (let i = 0; i < 42; i++) {
      const d = new Date(m.getFullYear(), m.getMonth(), 1 - offset + i), iso = isoOf(d);
      const cls = ['dp-d', d.getMonth() !== m.getMonth() && 'other', iso === today && 'today', iso === s.due && 'sel', i % 7 > 4 && 'we', iso < today && 'past'].filter(Boolean).join(' ');
      days += `<button type="button" class="${cls}" data-iso="${iso}" aria-label="${fmtLong.format(d)}">${d.getDate()}</button>`;
    }
    body = `<div class="dp-cal-h">
        <b>${fmtMonthYear.format(m)}</b>
        <button type="button" class="dp-nav" data-m="-1" title="Önceki ay">${ico('chev-l')}</button>
        <button type="button" class="dp-nav" data-m="1" title="Sonraki ay">${ico('chev-r')}</button>
      </div>
      <div class="dp-grid">${days}</div>`;
  }
  // Alt çipler: değer varsa göster (ve × ile kaldır), yoksa soluk etiket; tıklayınca gövdede o bölüm açılır
  const prop = (view, icon, label, value, clear) => `<span class="dp-prop${value ? ' set' : ''}${s.view === view ? ' cur' : ''}">
    <button type="button" class="dp-prop-b" data-view="${view}" title="${label}">${ico(icon)}<span>${esc(value || label)}</span></button>
    ${value ? `<button type="button" class="dp-prop-x" data-clear="${clear}" title="${label}: kaldır" aria-label="${label}: kaldır">${ico('x')}</button>` : ''}</span>`;
  const remVal = s.remind.length > 1 ? `${s.remind.length} hatırlatıcı` : s.remind.length ? remindLabel(s.remind[0]) : '';
  const props = [
    s.allowTime && prop('time', 'clock', 'Saat', s.time, 'time'),
    s.allowTime && prop('remind', 'bell', 'Hatırlat', remVal, 'remind'),
    s.allowRec && prop('rec', 'repeat', 'Tekrar', s.rec ? recLabel(s.rec) : '', 'rec'),
  ].filter(Boolean).join('');
  const sum = s.due ? `${fmtLong.format(parseISODate(s.due))}${s.time ? ` · ${s.time}` : ''}` : 'Tarih yok';
  const enter = s.view !== s.shown;   // bölüm değiştiyse gövde hafifçe belirsin
  s.shown = s.view;
  datePop.innerHTML = `
    <div class="dp-body dp-v-${s.view}${enter ? ' enter' : ''}">${body}</div>
    ${props ? `<div class="dp-props">${props}</div>` : ''}
    <div class="dp-foot"><span class="dp-sum${s.due ? '' : ' none'}">${esc(sum)}</span><button type="button" class="dp-done">${ico('check')}Tamam</button></div>`;

  // Gün seçince pencere kapanır; kullanıcı saat/hatırlatıcı/tekrar ile uğraşıyorsa açık kalır
  datePop.querySelectorAll('[data-iso]').forEach(b => b.onclick = () => commitDate({ due: b.dataset.iso || null }, !s.keep));
  datePop.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
    s.month = new Date(s.month.getFullYear(), s.month.getMonth() + Number(b.dataset.m), 1);
    renderDatePop();
  });
  datePop.querySelectorAll('[data-view]').forEach(b => b.onclick = () => {
    s.view = s.view === b.dataset.view ? 'cal' : b.dataset.view;
    if (s.view !== 'cal') s.keep = true;
    renderDatePop();
    positionDatePop();
  });
  datePop.querySelectorAll('[data-clear]').forEach(b => b.onclick = () => {
    s.keep = true;
    const k = b.dataset.clear;
    // Saat kalkınca ona bağlı göreli hatırlatıcılar da kalkar
    commitDate(k === 'time' ? { time: null, remind: s.remind.filter(t => !isRelRemind(t)) } : k === 'remind' ? { remind: [] } : { rec: null }, false);
  });
  datePop.querySelectorAll('[data-rec]').forEach(b => b.onclick = () => {
    const rec = b.dataset.rec || null;
    // Tekrar seçilip tarih yoksa bugünden başlasın
    commitDate({ rec, due: rec && !s.due ? todayISO() : s.due }, false);
  });
  // Saat: gün yoksa bugün atanır; seçilince takvime dönülür
  if (s.view === 'time') {
    bindTimeList(datePop, s.time, t => { s.view = 'cal'; commitDate({ time: t, due: s.due || todayISO() }, false); });
    datePop.querySelector('[data-time-none]').onclick = () => { s.view = 'cal'; commitDate({ time: null, remind: s.remind.filter(t => !isRelRemind(t)) }, false); };
  }
  datePop.querySelectorAll('[data-remind]').forEach(b => b.onclick = () => {
    const t = b.dataset.remind;
    commitDate({ remind: s.remind.includes(t) ? s.remind.filter(x => x !== t) : [...s.remind, t] }, false);
  });
  const rdBtn = datePop.querySelector('.dp-rd-btn');
  if (rdBtn) rdBtn.onclick = () => {
    const cur = s.remDate || s.due || today;
    const days = Array.from({ length: 120 }, (_, i) => addDays(today, i));
    if (!days.includes(cur)) days.unshift(cur);
    openListPop(rdBtn, days.map(d => ({ value: d, label: `${fmtLong.format(parseISODate(d))}${d === today ? ' · Bugün' : d === addDays(today, 1) ? ' · Yarın' : ''}` })), cur, d => { s.remDate = d; renderDatePop(); });
  };
  const rtBtn = datePop.querySelector('.dp-rt-btn');
  if (rtBtn) rtBtn.onclick = () => pickTime(rtBtn, rtBtn.querySelector('span').textContent, t => { s.remTime = t || '09:00'; renderDatePop(); });
  datePop.querySelector('.dp-radd')?.addEventListener('click', () => {
    const t = `${s.remDate || s.due || today}T${datePop.querySelector('.dp-rt-btn span').textContent}`;
    if (REMIND_RE.test(t) && !s.remind.includes(t)) commitDate({ remind: [...s.remind, t] }, false);
  });
  datePop.querySelector('.dp-done').onclick = closeDatePop;
}
const WEEKDAY_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const fmtMonthYear = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' });
const fmtLong = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShortDay = new Intl.DateTimeFormat('tr-TR', { weekday: 'short', day: 'numeric', month: 'short' });
document.addEventListener('mousedown', e => {
  if (datePopState && !e.target.closest('#datePop, #timePop, .list-pop') && !datePopState.anchor.contains(e.target)) closeDatePop();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && datePopState) closeDatePop(); });

let settings = {};

// Bağlantılar varsayılan tarayıcıda açılsın. Not editörünün içinde ise sadece Ctrl+tık ile
// (normal tık imleci bağlantının üzerine koysun ki düzenlenebilsin).
document.addEventListener('click', e => {
  const a = e.target.closest('a[href]');
  if (!a) return;
  e.preventDefault();
  if (a.closest('.toastui-editor-contents') && !e.ctrlKey) return;
  api.openExternal(a.href);
});

// Sürükle-bırak ortak durumu ve yardımcıları
let dragging = null; // { type: 'task', cat, task } | { type: 'cat', cat } | { type: 'note', name }
const upperHalf = (e, el) => { const r = el.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; };
const clearDropMarks = () => $$('.drop-before, .drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
function endDrag() {
  dragging = null;
  clearDropMarks();
  $$('.dragging').forEach(el => el.classList.remove('dragging'));
}
