// ============ Takvim ============
// Ay görünümü; son tarihi olan görevler günlerin altında nokta olarak görünür.
// Tam ekranda Hafta ve Gün görünümü de vardır (saat çizelgesi: saati olan görevler saatinde, olmayanlar "Gün boyu" şeridinde).
// Bir güne tıklayınca o güne ait görevler kartın altında listelenir; oradan işaretlenebilir / eklenebilir.
const fmtMonth = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' });
const fmtDateLong = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtFullDay = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
let calMonth = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })();
let calSelected = todayISO();
let calDayOpen = false;   // seçili günün görev penceresi açık mı
let calAddCat = null;     // gün penceresinden eklenecek görevin kategorisi
let calAddTime = null;    // gün penceresinden eklenecek görevin saati (çizelgede boş bir saate tıklanınca dolar)
let calAddDraft = '';     // gün penceresinde yazılmakta olan görev metni (kategori/saat değişince ya da yeniden çizilince korunur)
let calAnchorPt = null;   // çizelgede tıklanan nokta {x, y}: gün penceresi buraya yakın açılır
let calView = store.get('calView', 'month');   // 'month' | 'week' | 'day'; hafta ve gün yalnızca tam ekranda
let calDate = todayISO();                      // hafta/gün görünümünün gösterdiği gün
const activeCalView = () => (document.body.classList.contains('solo') ? calView : 'month');
const CAL_HOUR_PX = 44;                        // çizelgede bir saatin yüksekliği
const timeMins = t => +t.time.slice(0, 2) * 60 + +t.time.slice(3);
// Gün içi sıra: yapılmamışlar saate göre (saatsizler sonda), yapılmışlar altta
const byTime = (a, b) => (a.task.time || '99:99').localeCompare(b.task.time || '99:99');
const sortDay = items => [...items.filter(x => !x.task.done).sort(byTime), ...items.filter(x => x.task.done).sort(byTime)];

function calGoToday() {
  const d = new Date();
  calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  calSelected = todayISO();
  calDate = todayISO();
  renderCalendar();
}
function closeCalDay() {
  if (!calDayOpen) return;
  calDayOpen = false;
  $('#calDay').hidden = true;
  calAnchorPt = null;
  calAddTime = null;
  calAddDraft = '';
  document.querySelectorAll('.cal-d.sel, .cal-col-head.sel').forEach(c => c.classList.remove('sel'));
  document.querySelectorAll('.cal-pick').forEach(c => c.remove());   // pencere kapanınca seçim işareti de kalkar
}
// Pencere dışına tıklayınca / Esc ile kapansın
document.addEventListener('mousedown', e => {
  if (calDayOpen && !e.target.closest('#calDay, .cal-d, .cal-col, .cal-col-head, .cal-ad, #datePop, #timePop, #catPop')) closeCalDay();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCalDay(); });
window.addEventListener('resize', () => calDayOpen && positionCalDay());

// Kategori seçici (gün penceresindeki eklenecek görevin kategorisi): simgeli/renkli liste
const catPop = $('#catPop');
let catPopAnchor = null;
function closeCatPop() { catPop.hidden = true; catPopAnchor = null; }
function pickCategory(anchor, current, onPick) {
  catPopAnchor = anchor;
  catPop.innerHTML = activeCats().map(c => `<button type="button" data-n="${esc(c.name)}" class="${c.name === current ? 'on' : ''}"><span class="cb-mark" style="--c:${catColor(c)}">${c.icon ? `<span class="cat-ico">${c.icon}</span>` : '<span class="dot"></span>'}</span><span class="cp-name">${esc(c.name)}</span>${c.shared ? '<span class="cp-tag">ortak</span>' : ''}${c.name === current ? ico('check') : ''}</button>`).join('');
  catPop.querySelectorAll('button').forEach(b => b.onclick = () => { closeCatPop(); onPick(b.dataset.n); });
  catPop.hidden = false;
  const r = anchor.getBoundingClientRect(), w = Math.max(r.width, 200), h = catPop.offsetHeight;
  catPop.style.minWidth = `${w}px`;
  catPop.style.left = `${Math.min(Math.max(8, r.left), innerWidth - catPop.offsetWidth - 8)}px`;
  catPop.style.top = `${Math.max(8, r.top - h - 6 < 8 ? r.bottom + 6 : r.top - h - 6)}px`;   // genelde formun üstünde açılır
}
document.addEventListener('mousedown', e => { if (!catPop.hidden && !e.target.closest('#catPop') && !catPopAnchor?.contains(e.target)) closeCatPop(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCatPop(); });

// Pencereyi seçili günün hücresinin (çizelgede tıklanan noktanın) altına, yer yoksa üstüne yerleştir
function positionCalDay() {
  const box = $('#calDay');
  let r, card;
  if (calAnchorPt) {
    r = { left: calAnchorPt.x, top: calAnchorPt.y, bottom: calAnchorPt.y + 4, width: 0 };
    card = true;
  } else {
    const cell = document.querySelector(`.cal-grid:not([hidden]) .cal-d[data-iso="${calSelected}"], .cal-tl:not([hidden]) .cal-col-head[data-iso="${calSelected}"]`);   // görünür görünümdeki hücre
    card = cell?.closest('.card');
    if (!cell || !card || card.hidden) return closeCalDay();
    r = cell.getBoundingClientRect();
  }
  const width = Math.min(400, innerWidth - 16);
  box.style.width = `${width}px`;
  box.style.left = `${Math.min(Math.max(8, r.left + r.width / 2 - width / 2), innerWidth - width - 8)}px`;
  const h = box.offsetHeight;
  const below = r.bottom + 6;
  box.style.top = `${below + h > innerHeight - 8 ? Math.max(8, r.top - h - 6) : below}px`;
}
// Önceki / sonraki: ay, hafta ya da gün (görünüme göre)
function calStep(n) {
  const v = activeCalView();
  if (v === 'month') calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + n, 1);
  else calDate = addDays(calDate, n * (v === 'week' ? 7 : 1));
  renderCalendar();
}
$('#calPrev').onclick = () => calStep(-1);
$('#calNext').onclick = () => calStep(1);
$('#calToday').onclick = calGoToday;
$('#calViews').onclick = e => {
  const b = e.target.closest('[data-v]');
  if (!b || b.dataset.v === calView) return;
  // Görünümler arasında aynı döneme git: aydan haftaya geçerken bu ayın ilk günü (içinde bugün varsa bugün)
  if (calView === 'month') calDate = calMonth.getMonth() === new Date().getMonth() && calMonth.getFullYear() === new Date().getFullYear() ? todayISO() : isoOf(calMonth);
  else calMonth = new Date(parseISODate(calDate).getFullYear(), parseISODate(calDate).getMonth(), 1);
  calView = b.dataset.v;
  store.set('calView', calView);
  closeCalDay();
  renderCalendar();
};

// Son tarihe göre görevleri grupla: { '2026-10-10': [{cat, task}, …] }
function tasksByDue() {
  const map = new Map();
  for (const item of allTasks()) {
    if (!item.task.due) continue;
    if (!map.has(item.task.due)) map.set(item.task.due, []);
    map.get(item.task.due).push(item);
  }
  return map;
}

function renderCalendar() {
  if (!$('#calGrid')) return;
  const byDue = tasksByDue();
  const today = todayISO();
  const v = activeCalView();
  $('#calGrid').hidden = v !== 'month';
  $('#calTl').hidden = v === 'month';
  $('#calViews').querySelectorAll('[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  const unit = { month: 'ay', week: 'hafta', day: 'gün' }[v];
  $('#calPrev').title = `Önceki ${unit}`;
  $('#calNext').title = `Sonraki ${unit}`;
  if (v !== 'month') {
    renderCalTimeline(v, byDue);
    if (calDayOpen) renderCalDay(byDue);
    return;
  }
  $('#calTitle').textContent = fmtMonth.format(calMonth);

  // Pazartesi ile başlayan haftalar
  const first = new Date(calMonth);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  const weeks = Math.ceil((offset + new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()) / 7);

  let html = WEEKDAYS.map((w, i) => `<div class="cal-wd${i > 4 ? ' we' : ''}">${w}</div>`).join('');
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const iso = isoOf(d);
    const items = byDue.get(iso) || [];
    const open = items.filter(x => !x.task.done);
    const cls = ['cal-d'];
    if (d.getMonth() !== calMonth.getMonth()) cls.push('other');
    if (i % 7 > 4) cls.push('we');
    if (iso === today) cls.push('today');
    if (calDayOpen && iso === calSelected) cls.push('sel');
    // Nokta rengi: geçmiş + açık görev → kırmızı, bugün → turuncu, ileri → vurgu, hepsi bitmiş → yeşil
    let dot = '';
    if (items.length) {
      const state = !open.length ? 'done' : iso < today ? 'overdue' : iso === today ? 'today' : 'future';
      const n = open.length || items.length;
      dot = `<span class="cal-dots ${state}">${'<i></i>'.repeat(Math.min(n, 3))}</span>`;
    }
    const tip = items.length ? `${open.length} açık / ${items.length} görev` : '';
    // Tam ekranda hücrenin içinde görev başlıkları görünür (panoda CSS ile gizli, yalnızca noktalar)
    const sorted = sortDay(items);
    const chips = sorted.slice(0, 4).map(({ cat, task }) => {
      const late = !task.done && iso < today;
      return `<span class="cal-item${task.done ? ' done' : ''}${late ? ' late' : ''}" style="--c:${catColor(cat)}">${task.time ? `<b>${task.time}</b> ` : ''}${esc(task.text)}</span>`;
    }).join('') + (sorted.length > 4 ? `<span class="cal-more">+${sorted.length - 4} daha</span>` : '');
    html += `<button class="${cls.join(' ')}" data-iso="${iso}" title="${tip}"><span class="cal-n">${d.getDate()}</span>${dot}<span class="cal-items">${chips}</span></button>`;
  }
  const grid = $('#calGrid');
  grid.style.setProperty('--weeks', weeks);
  grid.innerHTML = html;
  // Görevi bir günün üzerine sürükleyip bırakınca son tarihi o gün olur
  grid.querySelectorAll('.cal-d').forEach(b => {
    b.addEventListener('dragover', e => {
      if (dragging?.type !== 'task') return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      grid.querySelectorAll('.drop-day').forEach(x => x !== b && x.classList.remove('drop-day'));
      b.classList.add('drop-day');
    });
    b.addEventListener('dragleave', () => b.classList.remove('drop-day'));
    b.addEventListener('drop', e => {
      if (dragging?.type !== 'task') return;
      e.preventDefault();
      const { task } = dragging;
      endDrag();
      task.due = b.dataset.iso;
      saveTodos();
    });
  });
  grid.querySelectorAll('.cal-d').forEach(b => b.onclick = () => {
    // Aynı güne tekrar tıklamak pencereyi kapatır
    if (calDayOpen && calSelected === b.dataset.iso) return closeCalDay();
    openCalDay(b.dataset.iso);
  });
  if (calDayOpen) renderCalDay(byDue);
}

// Takvimde bir günü seçip gün penceresini açar. Hücreye tıklamanın yanı sıra sesli asistanın
// "highlight_date" ile bir cevabı görsel olarak göstermesi için de kullanılır.
// opts.time: eklenecek görevin saati · opts.at: {x, y} pencerenin açılacağı nokta (çizelgede boş saate tıklama)
function openCalDay(iso, opts = {}) {
  calSelected = iso;
  calDayOpen = true;
  calAddTime = opts.time || null;
  calAnchorPt = opts.at || null;
  calDate = iso;
  const d = parseISODate(iso);
  if (d.getMonth() !== calMonth.getMonth()) calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  renderCalendar();
  if (opts.at) $('#calDay .cd-add input')?.focus();
}

// Gün penceresi: üstte gün (büyük gün numarası, gün adı, ay yıl ve hafta; ‹ › ile günler arası geçiş), ortada görevler (tek liste), altta ekleme formu.
// Çizelgede boş bir saate ya da "Gün boyu" şeridine tıklanınca gün (ve saat) dolu gelir.
function renderCalDay(byDue) {
  const box = $('#calDay');
  const items = byDue.get(calSelected) || [];
  const today = todayISO();
  const overdue = calSelected === today
    ? allTasks().filter(x => x.task.due && x.task.due < today && !x.task.done)
    : [];
  const d = parseISODate(calSelected);
  const cats = activeCats();
  if (!cats.some(c => c.name === calAddCat)) calAddCat = currentCat().name;
  const addCat = cats.find(c => c.name === calAddCat);

  box.hidden = false;
  box.innerHTML = `
    <div class="cd-head">
      <button type="button" class="cd-nav" data-d="-1" title="Önceki gün">${ico('chev-l')}</button>
      <div class="cd-date">
        <b class="cd-full">${fmtDateLong.format(d)}</b>
        <span class="cd-wd">${fmtWeekday.format(d)}</span>
      </div>
      <button type="button" class="cd-nav" data-d="1" title="Sonraki gün">${ico('chev-r')}</button>
      <button type="button" class="icon-btn cal-close" title="Kapat (Esc)">✕</button>
    </div>
    <div class="cd-body"></div>
    <form class="cd-add">
      <input placeholder="Görev ekle…  (örn. 15:30 toplantı)" autocomplete="off">
      <div class="cd-opts">
        <button type="button" class="cd-timebtn${calAddTime ? ' on' : ''}" title="Saat seç (15 dakikalık adımlar)">${ico('clock')}<span>${calAddTime || 'Saat'}</span></button>
        <button type="button" class="cd-catbtn" title="Kategori"><span class="cb-mark" style="--c:${catColor(addCat)}">${addCat.icon ? `<span class="cat-ico">${addCat.icon}</span>` : '<span class="dot"></span>'}</span><span class="cb-name">${esc(addCat.name)}</span>${ico('chev-d')}</button>
        <button type="submit" class="cd-submit">Ekle</button>
      </div>
    </form>`;

  // Tek liste: gecikmişler (bugünse), gün boyu görevler, sonra saate göre saatliler
  const body = box.querySelector('.cd-body');
  const rows = [
    ...overdue.map(x => [x, true]),
    ...sortDay(items.filter(x => !x.task.time)).map(x => [x, false]),
    ...sortDay(items.filter(x => x.task.time)).map(x => [x, false]),
  ];
  if (rows.length) {
    const ul = document.createElement('ul');
    ul.className = 'cal-tasks';
    rows.forEach(([x, late]) => ul.append(calDayRow(x, late)));
    body.append(ul);
  } else body.innerHTML = '<div class="cd-empty">Bu gün boş.<br><span class="muted">Aşağıdan görev ekleyebilirsin.</span></div>';

  box.querySelector('.cal-close').onclick = e => { e.stopPropagation(); closeCatPop(); closeCalDay(); };
  box.querySelectorAll('.cd-nav').forEach(b => b.onclick = () => openCalDay(addDays(calSelected, +b.dataset.d)));
  const form = box.querySelector('.cd-add'), input = form.querySelector('input');
  input.value = calAddDraft;
  input.addEventListener('input', () => { calAddDraft = input.value; });
  const catBtn = form.querySelector('.cd-catbtn');
  catBtn.onclick = () => pickCategory(catBtn, calAddCat, name => { calAddCat = name; renderCalDay(byDue); $('#calDay .cd-add input')?.focus(); });
  const timeBtn = form.querySelector('.cd-timebtn');
  timeBtn.onclick = () => pickTime(timeBtn, calAddTime, t => {
    calAddTime = t;
    timeBtn.querySelector('span').textContent = t || 'Saat';
    timeBtn.classList.toggle('on', !!t);
  });
  positionCalDay();
  form.onsubmit = e => {
    e.preventDefault();
    const parsed = parseTaskBody(input.value.trim());
    const nl = parseNatural(parsed.text);   // "her hafta", "15:30" gibi ifadeler de tanınsın
    const text = nl.text || parsed.text;
    if (!text) return;
    const cat = activeCats().find(c => c.name === calAddCat) || currentCat();
    const time = parsed.time || nl.time || calAddTime;
    addTask(cat, text, calSelected, parsed.rec || nl.rec, time, { priority: parsed.priority, remind: parsed.remind }).then(closeCalDay);   // eklenince pencere kapanır
  };
}

// Gün penceresindeki bir görev satırı: onay kutusu, metin, tekrar/zil simgeleri, saat (tıklayınca gün/saat/hatırlatıcı), kategori, sil
function calDayRow({ cat, task }, late) {
  const li = document.createElement('li');
  li.className = (task.done ? 'done' : '') + (late ? ' late' : '');
  li.style.setProperty('--c', catColor(cat));
  if (task.priority) li.dataset.p = task.priority;
  li.title = taskTitle(task).replace('\nDüzenlemek için tıkla', '') + '\n(Başka bir güne sürükleyebilirsin)';
  li.draggable = true;
  li.innerHTML = `<input type="checkbox" ${task.done ? 'checked' : ''}>`
    + `<span class="txt">${renderInline(task.text)}</span>`
    + (task.rec ? `<span class="rec" title="${esc(recLabel(task.rec))}">${ico('repeat')}</span>` : '')
    + (task.remind?.length ? `<span class="bell" title="Hatırlatıcı var">${ico('bell')}</span>` : '')
    + `<button type="button" class="cd-t${task.time ? '' : ' none'}" title="Gün / saat / hatırlatıcı">${task.time || ico('clock')}</button>`
    + (late ? `<span class="late-tag">${dueInfo(task.due, false).label}</span>` : '')
    + `<button type="button" class="cat-tag cd-cat" title="Kategoriyi değiştir">${cat.icon ? `<span class="cat-ico">${cat.icon}</span>` : '<span class="dot"></span>'}${esc(cat.name)}</button>`
    + `<button type="button" class="cd-prio${task.priority ? ' set' : ''}" title="Öncelik">${ico('flag')}</button>`
    + '<button type="button" class="cd-del" title="Sil">✕</button>';
  li.querySelector('input').onchange = e => setDone(cat, task, e.target.checked);
  const tb = li.querySelector('.cd-t');
  tb.onclick = () => pickDate(tb, { due: task.due, rec: task.rec, time: task.time, remind: task.remind }, v => setDueRec(task, v));
  li.querySelector('.cd-del').onclick = () => { deleteTask(cat, task); saveTodos(); };
  const cb = li.querySelector('.cd-cat');
  cb.onclick = () => pickCategory(cb, cat.name, name => { const dest = activeCats().find(c => c.name === name); if (dest) moveToCategory(cat, task, dest); });
  const pb = li.querySelector('.cd-prio');
  pb.onclick = () => pickPriority(pb, task.priority || 0, n => { task.priority = n || undefined; saveTodos(); });
  li.addEventListener('dragstart', e => { dragging = { type: 'task', cat, task }; e.dataTransfer.effectAllowed = 'move'; li.classList.add('dragging'); });
  li.addEventListener('dragend', endDrag);
  return li;
}

// ============ Hafta / Gün görünümü (tam ekran) ============
// Üstte gün başlıkları, altında "Gün boyu" şeridi (saati olmayan görevler), sonra saat çizelgesi.
// Görev bloğunu başka güne ya da başka saate sürüklemek son tarihini / saatini değiştirir.
let calTlScroll = null;
function renderCalTimeline(v, byDue) {
  const today = todayISO(), tl = $('#calTl');
  const cur = tl.querySelector('.cal-tl-body');
  if (cur) calTlScroll = cur.scrollTop;
  let days;
  if (v === 'day') days = [calDate];
  else {
    const mon = addDays(calDate, -((parseISODate(calDate).getDay() + 6) % 7));
    days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  }
  $('#calTitle').textContent = v === 'day'
    ? fmtFullDay.format(parseISODate(calDate))
    : `${fmtDayMonth.format(parseISODate(days[0]))} – ${fmtDayMonthYear.format(parseISODate(days[6]))}`;

  // Çizelge günün tamamını (00:00–24:00) gösterir; alanda yukarı aşağı kaydırılır
  const lo = 0, hi = 24;
  const H = CAL_HOUR_PX, height = (hi - lo) * H;
  const chipText = ({ task }) => `${task.time ? `<b>${task.time}</b> ` : ''}${esc(task.text)}`;
  const chipCls = (task, iso) => `${task.done ? ' done' : ''}${!task.done && iso < today ? ' late' : ''}`;

  // Gün başlıkları: her günde gün adı, büyük gün numarası ve ay (ayın 1'inde / ilk sütunda vurgulu).
  // Gün görünümünde tek geniş başlık: numara, tam gün adı, ay yıl ve Bugün/Yarın/Dün.
  // "Gün boyu" şeridi: solda simge + etiket + açık görev sayısı; hücrede boş yere tıklamak görev ekler (üzerine gelince "Ekle" ipucu).
  const fmtMon = new Intl.DateTimeFormat('tr-TR', { month: 'short' }), fmtMonLong = new Intl.DateTimeFormat('tr-TR', { month: 'long' });
  const untimed = iso => (byDue.get(iso) || []).filter(x => !x.task.time).sort((a, b) => a.task.done - b.task.done);
  const openAd = days.reduce((n, iso) => n + untimed(iso).filter(x => !x.task.done).length, 0);
  let head = '<div class="cal-tl-gutter"></div>';
  let allday = `<div class="cal-tl-gutter cal-tl-lbl">${ico('sun')}<span>Gün boyu</span>${openAd ? `<em title="${openAd} açık görev">${openAd}</em>` : ''}</div>`, cols = '';
  days.forEach((iso, di) => {
    const d = parseISODate(iso), items = byDue.get(iso) || [];
    const we = (d.getDay() + 6) % 7 > 4;
    const cls = `${iso === today ? ' today' : ''}${iso < today ? ' past' : ''}${we ? ' we' : ''}${calDayOpen && iso === calSelected ? ' sel' : ''}${d.getDate() === 1 || di === 0 ? ' m1' : ''}`;
    const rel = { 0: 'Bugün', 1: 'Yarın', '-1': 'Dün' }[dayDiff(iso)];
    head += v === 'day'
      ? `<button type="button" class="cal-col-head cal-dh${cls}" data-iso="${iso}"><b class="ch-n">${d.getDate()}</b><span class="ch-info"><span class="ch-wd">${fmtWeekday.format(d)}</span><span class="ch-mon">${fmtMonth.format(d)}</span></span>${rel ? `<span class="ch-rel">${rel}</span>` : ''}</button>`
      : `<button type="button" class="cal-col-head${cls}" data-iso="${iso}" title="${fmtFullDay.format(d)}"><span class="ch-wd">${WEEKDAYS[(d.getDay() + 6) % 7]}</span><span class="ch-date"><b class="ch-n">${d.getDate()}</b><span class="ch-mon">${(d.getDate() === 1 ? fmtMonLong : fmtMon).format(d)}</span></span></button>`;
    const ad = untimed(iso);
    allday += `<div class="cal-ad${ad.length ? '' : ' empty'}" data-iso="${iso}">${ad.map(({ cat, task }, k) => `<span class="cal-item cal-ad-item${chipCls(task, iso)}" draggable="true" data-iso="${iso}" data-k="${k}" style="--c:${catColor(cat)}" title="${esc(task.text)} · ${esc(cat.name)}"><i class="cal-chk" title="Tamamla / geri al">${ico('check')}</i><span class="cal-ad-t">${esc(task.text)}</span></span>`).join('')}<span class="cal-ad-add" title="Gün boyu görev ekle">${ico('plus')}<span>Ekle</span></span></div>`;

    // Saatli görevler: üst üste binenler yan yana
    const evs = items.filter(x => x.task.time).map(x => ({ ...x, start: timeMins(x.task) })).sort((a, b) => a.start - b.start);
    let cluster = [], clusterEnd = -1, laneEnds = [];
    const flush = () => { const n = laneEnds.length || 1; cluster.forEach(e => { e.lanes = n; }); cluster = []; laneEnds = []; };
    for (const e of evs) {
      if (e.start >= clusterEnd) { flush(); clusterEnd = -1; }
      let lane = laneEnds.findIndex(end => end <= e.start);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = e.start + 30;
      e.lane = lane;
      clusterEnd = Math.max(clusterEnd, e.start + 30);
      cluster.push(e);
    }
    flush();
    const hours = Array.from({ length: hi - lo }, () => '<i></i>').join('');
    const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
    cols += `<div class="cal-col${we ? ' we' : ''}" data-iso="${iso}" style="height:${height}px"><div class="cal-hours">${hours}</div>`
      + evs.map(e => `<div class="cal-ev${chipCls(e.task, iso)}" draggable="true" data-iso="${iso}" data-t="${e.task.time}" style="--c:${catColor(e.cat)};top:${(e.start - lo * 60) / 60 * H}px;height:${H / 2 - 2}px;left:${e.lane / e.lanes * 100}%;width:calc(${100 / e.lanes}% - 2px)" title="${esc(e.task.text)}">${chipText(e)}</div>`).join('')
      + (iso === today && nowMin >= lo * 60 && nowMin < hi * 60 ? `<div class="cal-now" style="top:${(nowMin - lo * 60) / 60 * H}px"></div>` : '')
      + '</div>';
  });
  const labels = Array.from({ length: hi - lo }, (_, i) => `<span style="height:${H}px">${String(lo + i).padStart(2, '0')}:00</span>`).join('');
  tl.style.setProperty('--cols', days.length);
  tl.classList.toggle('day', v === 'day');
  tl.innerHTML = `<div class="cal-tl-row cal-tl-heads">${head}</div><div class="cal-tl-row cal-tl-allday">${allday}</div>`
    + `<div class="cal-tl-body"><div class="cal-tl-row"><div class="cal-tl-gutter cal-tl-hrs">${labels}</div>${cols}</div></div>`;
  const body = tl.querySelector('.cal-tl-body');
  // İlk açılışta bugünün (yoksa sabah 07:00'nin) civarına kaydır
  body.scrollTop = calTlScroll ?? Math.max(0, (days.includes(today) ? Math.max(0, new Date().getHours() - 1) : 7) * H);

  // Bir görev öğesinden (chip) görevi bul: aynı gün listesindeki sıraya göre
  const taskOf = el => {
    const items = byDue.get(el.dataset.iso) || [];
    if (el.dataset.t) return items.filter(x => x.task.time).sort((a, b) => timeMins(a.task) - timeMins(b.task))[[...el.parentElement.querySelectorAll('.cal-ev')].indexOf(el)];
    return items.filter(x => !x.task.time).sort((a, b) => a.task.done - b.task.done)[+el.dataset.k];
  };
  tl.querySelectorAll('.cal-ev, .cal-ad .cal-item').forEach(el => {
    const item = taskOf(el);
    if (!item) return;
    el.onclick = () => openCalDay(el.dataset.iso);
    const chk = el.querySelector('.cal-chk');
    if (chk) chk.onclick = e => { e.stopPropagation(); setDone(item.cat, item.task, !item.task.done); };
    el.addEventListener('dragstart', e => { dragging = { type: 'task', cat: item.cat, task: item.task }; e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
    el.addEventListener('dragend', endDrag);
  });
  tl.querySelectorAll('.cal-col-head').forEach(b => b.onclick = () => {
    if (calDayOpen && calSelected === b.dataset.iso) return closeCalDay();
    openCalDay(b.dataset.iso);
  });
  // Boş bir saate tıklamak: o gün ve saat (15 dk adımla) dolu olarak görev ekleme penceresini açar
  tl.querySelectorAll('.cal-col').forEach(col => col.addEventListener('click', e => {
    if (e.target.closest('.cal-ev')) return;
    const mins = Math.max(0, Math.min(24 * 60 - 15, Math.floor(((e.clientY - col.getBoundingClientRect().top) / H * 60 + lo * 60) / 15) * 15));
    const time = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    openCalDay(col.dataset.iso, { time, at: { x: e.clientX, y: e.clientY } });
    document.querySelectorAll('.cal-pick').forEach(c => c.remove());
    const pick = document.createElement('div');
    pick.className = 'cal-pick';
    pick.style.top = `${(mins - lo * 60) / 60 * H}px`;
    pick.dataset.t = time;
    tl.querySelector(`.cal-col[data-iso="${col.dataset.iso}"]`)?.append(pick);
  }));
  // Bırakma: gün sütununa → gün (ve saat, 15 dk adımla); "Gün boyu" şeridine → gün, saatsiz
  // "Gün boyu" şeridinin boş yerine tıklamak: o gün için saatsiz görev ekleme penceresini açar
  tl.querySelectorAll('.cal-ad').forEach(ad => ad.addEventListener('click', e => {
    if (e.target.closest('.cal-item')) return;
    openCalDay(ad.dataset.iso, { at: { x: e.clientX, y: e.clientY } });
  }));
  // Bırakma: gün sütununa → gün ve saat (15 dk adımla, imlecin bulunduğu dilim); "Gün boyu" şeridine → gün, saatsiz.
  // Sürüklerken yeni saat gölge blok ve etiketle önceden gösterilir.
  const slotTime = (e, col) => {
    const m = Math.max(0, Math.min(24 * 60 - 15, Math.floor(((e.clientY - col.getBoundingClientRect().top) / H * 60 + lo * 60) / 15) * 15));
    return { m, time: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` };
  };
  const ghost = document.createElement('div');
  ghost.className = 'cal-ghost';
  const hideGhost = () => ghost.remove();
  const dropTargets = tl.querySelectorAll('.cal-col, .cal-ad');
  dropTargets.forEach(t => {
    t.addEventListener('dragover', e => {
      if (dragging?.type !== 'task') return;
      e.preventDefault();
      dropTargets.forEach(x => x !== t && x.classList.remove('drop-day'));
      t.classList.add('drop-day');
      if (t.classList.contains('cal-col')) {
        const { m, time } = slotTime(e, t);
        ghost.style.top = `${(m - lo * 60) / 60 * H}px`;
        ghost.style.height = `${H / 2 - 2}px`;
        ghost.style.setProperty('--c', catColor(dragging.cat));
        ghost.innerHTML = `<b>${time}</b> ${esc(dragging.task.text)}`;
        if (ghost.parentElement !== t) t.append(ghost);
      } else hideGhost();
    });
    t.addEventListener('dragleave', e => { if (!t.contains(e.relatedTarget)) { t.classList.remove('drop-day'); hideGhost(); } });
    t.addEventListener('drop', e => {
      if (dragging?.type !== 'task') return;
      e.preventDefault();
      const { cat, task } = dragging;
      endDrag();
      hideGhost();
      task.due = t.dataset.iso;
      if (t.classList.contains('cal-col')) task.time = slotTime(e, t).time; else delete task.time;
      saveTodos();
    });
  });
  document.addEventListener('dragend', hideGhost, { once: true });
}
