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
  let text = input.trim(), due = null, rec = null;
  const r = takePhrase(text, NL_REC_RE, s => normalizeRec(s.replace('haftaiçi', 'hafta içi')));
  if (r) { rec = r.value; text = r.text; }
  for (const [pattern, fn] of NL_DATE_RULES) {
    const d = takePhrase(text, pattern, fn);
    if (d) { due = d.value; text = d.text; break; }
  }
  return { text, due, rec };
}

// ============ Tarih penceresi ============
// Görev son tarihi ve tekrarı için ortak açılır pencere: hızlı seçenekler, yazarak tarih,
// küçük ay görünümü ve tekrar seçenekleri. onChange({ due, rec }) ile bildirir.
const datePop = document.getElementById('datePop');
let datePopState = null;
function pickDate(anchor, { due = null, rec = null, allowRec = true } = {}, onChange, onClose) {
  const base = due || todayISO();
  datePopState = { anchor, due, rec, allowRec, onChange, onClose, month: new Date(parseISODate(base).getFullYear(), parseISODate(base).getMonth(), 1) };
  renderDatePop();
  datePop.hidden = false;
  positionDatePop();
  datePop.querySelector('.dp-text').focus();
}
function closeDatePop() {
  const onClose = datePopState?.onClose;
  datePop.hidden = true;
  datePopState = null;
  onClose?.();   // ör. yeni görev satırı yazma odağını geri alır
}
function positionDatePop() {
  const r = datePopState.anchor.getBoundingClientRect();
  const w = datePop.offsetWidth, h = datePop.offsetHeight;
  datePop.style.left = `${Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8)}px`;
  const top = r.bottom + 6 + h > innerHeight - 8 ? r.top - h - 6 : r.bottom + 6;
  datePop.style.top = `${Math.max(8, Math.min(top, innerHeight - h - 8))}px`;   // her durumda ekranda kalsın
}
function commitDate(patch, close) {
  Object.assign(datePopState, patch);
  datePopState.onChange({ due: datePopState.due, rec: datePopState.rec });
  // Liste yeniden çizilince bağlı düğme yok olabilir; o zaman pencere olduğu yerde kalsın
  if (close) closeDatePop(); else { renderDatePop(); if (datePopState.anchor.isConnected) positionDatePop(); }
}
function renderDatePop() {
  const s = datePopState, today = todayISO();
  const nextMonday = (() => { let d = addDays(today, 1); while (parseISODate(d).getDay() !== 1) d = addDays(d, 1); return d; })();
  const quick = [['Bugün', today], ['Yarın', addDays(today, 1)], ['Haftaya', addDays(today, 7)], ['Pazartesi', nextMonday]];
  const m = s.month;
  const offset = (m.getDay() + 6) % 7;
  const start = new Date(m.getFullYear(), m.getMonth(), 1 - offset);
  const weeks = Math.ceil((offset + new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()) / 7);
  let days = WEEKDAY_SHORT.map(w => `<span class="dp-wd">${w}</span>`).join('');
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), iso = isoOf(d);
    const cls = ['dp-d', d.getMonth() !== m.getMonth() && 'other', iso === today && 'today', iso === s.due && 'sel', i % 7 > 4 && 'we'].filter(Boolean).join(' ');
    days += `<button type="button" class="${cls}" data-iso="${iso}">${d.getDate()}</button>`;
  }
  datePop.innerHTML = `
    <div class="dp-quick">
      ${quick.map(([l, iso]) => `<button type="button" data-iso="${iso}" class="${s.due === iso ? 'on' : ''}">${l}</button>`).join('')}
      <button type="button" data-iso="" class="none ${s.due ? '' : 'on'}">Tarihsiz</button>
    </div>
    <input class="dp-text" placeholder="Yaz: cuma, 15 ekim, 3 gün sonra… (Enter)" autocomplete="off">
    <div class="dp-head">
      <button type="button" class="dp-nav" data-m="-1">‹</button>
      <b>${fmtMonthYear.format(m)}</b>
      <button type="button" class="dp-nav" data-m="1">›</button>
    </div>
    <div class="dp-grid">${days}</div>
    ${s.allowRec ? `<div class="dp-rec"><span class="muted">↻ Tekrar</span>
      <button type="button" data-rec="" class="${s.rec ? '' : 'on'}">Yok</button>
      ${REC_PRESETS.map(([k, l]) => `<button type="button" data-rec="${k}" class="${s.rec === k ? 'on' : ''}">${l}</button>`).join('')}
      ${s.rec && !REC_PRESETS.some(([k]) => k === s.rec) ? `<button type="button" data-rec="${esc(s.rec)}" class="on">${esc(recLabel(s.rec))}</button>` : ''}
    </div>` : ''}`;
  datePop.querySelectorAll('[data-iso]').forEach(b => b.onclick = () => commitDate({ due: b.dataset.iso || null }, true));
  datePop.querySelectorAll('.dp-nav').forEach(b => b.onclick = () => {
    s.month = new Date(m.getFullYear(), m.getMonth() + Number(b.dataset.m), 1);
    renderDatePop();
  });
  datePop.querySelectorAll('[data-rec]').forEach(b => b.onclick = () => {
    const rec = b.dataset.rec || null;
    // Tekrar seçilip tarih yoksa bugünden başlasın
    commitDate({ rec, due: rec && !s.due ? todayISO() : s.due }, false);
  });
  const input = datePop.querySelector('.dp-text');
  input.onkeydown = e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    // "x" ön ekiyle çözümle (takePhrase boş metin kabul etmediği için)
    const p = parseNatural(`x ${input.value}`);
    if (p.due || p.rec) commitDate({ due: p.due || s.due || (p.rec ? todayISO() : null), rec: p.rec || s.rec }, !p.rec);
    else { input.classList.add('bad'); setTimeout(() => input.classList.remove('bad'), 600); }
  };
}
const WEEKDAY_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const fmtMonthYear = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' });
document.addEventListener('mousedown', e => {
  if (datePopState && !e.target.closest('#datePop') && !datePopState.anchor.contains(e.target)) closeDatePop();
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
