// ============ Kart düzeni ============
// Satır tabanlı ızgara: her satırda bir ya da birden fazla kart yan yana durur
// (ör. üstte 3 sütun, altta 2 sütun). Boyutlar oransaldır:
//   · satır.size → satırın yüksekliği (diğer satırlara oranla)
//   · kart.size  → kartın satır içindeki genişliği (yanındakilere oranla)
// Kartların arasındaki boşluklar her zaman sürüklenebilir (genişlik / yükseklik ayarı).
// Üst çubuktaki "Düzenle" ile kartlar taşınır, gizlenir ve geri eklenir.
const CARDS = {
  clock: 'Saat',
  spark: 'Spark',
  weather: 'Hava durumu',
  calendar: 'Takvim',
  stats: 'Özet',
  todos: 'Yapılacaklar',
  notes: 'Notlar',
};
const DEFAULT_LAYOUT = {
  v: 2,
  rows: [
    { size: 1.35, cols: [{ card: 'clock', size: 1 }, { card: 'spark', size: 1.2 }, { card: 'weather', size: 2.3 }, { card: 'stats', size: 1.4 }] },
    { size: 2, cols: [{ card: 'calendar', size: 1 }, { card: 'todos', size: 1.3 }, { card: 'notes', size: 2.5 }] },
  ],
  hidden: [],
  compactWeather: false,
};
const MIN_COL_PX = 200;
const MIN_ROW_PX = 130;
const clone = o => JSON.parse(JSON.stringify(o));

// Kayıtlı düzeni doğrula ve tamamla: her kart tam bir kez (bir satırda ya da gizli) bulunsun
function normalizeLayout(saved) {
  // Eski (iki sütunlu) biçimden geliyorsa varsayılana geç, gizli/sade ayarlarını koru
  const l = saved && saved.v === 2 ? clone(saved) : { ...clone(DEFAULT_LAYOUT), hidden: saved?.hidden || [], compactWeather: !!saved?.compactWeather };
  const seen = new Set();
  const ok = id => id in CARDS && !seen.has(id) && seen.add(id);
  l.rows = (l.rows || [])
    .map(r => ({ size: r.size > 0 ? r.size : 1, cols: (r.cols || []).filter(c => ok(c.card)).map(c => ({ card: c.card, size: c.size > 0 ? c.size : 1 })) }))
    .filter(r => r.cols.length);
  l.hidden = (l.hidden || []).filter(ok);
  // Yeni eklenmiş (kayıtlı düzende hiç olmayan) kartlar ilk satırın sonuna eklenir; böylece
  // kullanıcının kendi ayarladığı düzen bozulmaz, yeni kart da gözden kaçmaz.
  const missing = Object.keys(CARDS).filter(id => !seen.has(id));
  if (!l.rows.length) return clone(DEFAULT_LAYOUT);
  for (const card of missing) {
    const row = l.rows[0];
    row.cols.push({ card, size: row.cols.reduce((s, c) => s + c.size, 0) / row.cols.length });
  }
  return l;
}
let layout = null;   // geçerli düzen (normalize edilmiş)
let view = 'dashboard';   // 'dashboard' (pano: tüm kartlar) ya da tam ekran gösterilen kartın kimliği
const cardEls = {};  // kart öğeleri: düzen yeniden kurulurken aynı öğeler taşınır
const cardStore = document.createElement('div');   // gizli kartların bekleme yeri
cardStore.hidden = true;
document.body.append(cardStore);

// --- Düzeni DOM'a uygula ---
function applyLayout() {
  if (!layout) layout = normalizeLayout(settings.layout);
  for (const id of Object.keys(CARDS)) cardEls[id] ||= document.querySelector(`.card[data-card="${id}"]`);
  const root = $('#layout');
  root.innerHTML = '';
  addFullscreenButtons();
  renderNav();
  if (view !== 'dashboard') {
    // Tam ekran: yalnızca seçili kart (gizlenmiş olsa bile) tüm alanı kaplar, diğerleri beklemeye alınır
    const rowEl = document.createElement('div');
    rowEl.className = 'lrow';
    for (const id of Object.keys(CARDS)) if (id !== view) cardStore.append(cardEls[id]);
    const el = cardEls[view];
    el.hidden = false;
    el.style.flexGrow = 1;
    rowEl.append(el);
    root.append(rowEl);
    cardEls.weather.classList.remove('compact');   // tam ekranda hava durumu her zaman ayrıntılı
    window.dispatchEvent(new Event('resize'));
    return;
  }
  layout.rows.forEach((row, ri) => {
    if (ri > 0) root.append(makeGutter('row', ri - 1, ri));
    const rowEl = document.createElement('div');
    rowEl.className = 'lrow';
    rowEl.style.flexGrow = row.size;
    row.cols.forEach((col, ci) => {
      if (ci > 0) rowEl.append(makeGutter('col', ci - 1, ci, ri));
      const el = cardEls[col.card];
      el.style.flexGrow = col.size;
      el.hidden = false;
      rowEl.append(el);
    });
    root.append(rowEl);
  });
  for (const id of layout.hidden) { cardEls[id].hidden = true; cardStore.append(cardEls[id]); }
  cardEls.weather.classList.toggle('compact', !!layout.compactWeather);
  if (editingLayout) renderEditTray();
  // Not editörünün araç çubuğu ve açık pencereler yeni boyutlara uysun
  window.dispatchEvent(new Event('resize'));
}

async function saveLayout(rerender = true) {
  settings = await api.settings.set({ layout });
  if (rerender) applyLayout();
}

// --- Boyutlandırma: kartlar / satırlar arasındaki boşluğu sürükle ---
function makeGutter(kind, a, b, rowIndex) {
  const g = document.createElement('div');
  g.className = `gutter ${kind}`;
  g.title = kind === 'col' ? 'Sürükleyerek genişliği ayarla' : 'Sürükleyerek yüksekliği ayarla';
  g.addEventListener('mousedown', e => startResize(e, g, kind, a, b, rowIndex));
  g.addEventListener('dblclick', () => {
    // Çift tık: iki tarafı eşitle
    const items = kind === 'col' ? layout.rows[rowIndex].cols : layout.rows;
    const avg = (items[a].size + items[b].size) / 2;
    items[a].size = items[b].size = avg;
    saveLayout();
  });
  return g;
}
function startResize(e, gutter, kind, a, b, rowIndex) {
  e.preventDefault();
  const horiz = kind === 'col';
  const items = horiz ? layout.rows[rowIndex].cols : layout.rows;
  const elA = gutter.previousElementSibling, elB = gutter.nextElementSibling;
  const size = el => (horiz ? el.getBoundingClientRect().width : el.getBoundingClientRect().height);
  const pxA = size(elA), pxB = size(elB), totalPx = pxA + pxB;
  const total = items[a].size + items[b].size;
  const min = horiz ? MIN_COL_PX : MIN_ROW_PX;
  const start = horiz ? e.clientX : e.clientY;
  document.body.classList.add(horiz ? 'resizing-col' : 'resizing-row');
  gutter.classList.add('active');
  const move = ev => {
    const d = (horiz ? ev.clientX : ev.clientY) - start;
    const na = Math.max(min, Math.min(totalPx - min, pxA + d));
    items[a].size = (total * na) / totalPx;
    items[b].size = total - items[a].size;
    elA.style.flexGrow = items[a].size;
    elB.style.flexGrow = items[b].size;
  };
  const up = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    document.body.classList.remove('resizing-col', 'resizing-row');
    gutter.classList.remove('active');
    window.dispatchEvent(new Event('resize'));
    saveLayout(false);
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

// --- Düzenleme modu: kart taşıma / gizleme ---
let editingLayout = false;
let dragCard = null;

function locate(id) {
  for (let r = 0; r < layout.rows.length; r++) {
    const c = layout.rows[r].cols.findIndex(x => x.card === id);
    if (c !== -1) return { r, c };
  }
  return null;
}
// Kartı bulunduğu yerden çıkar (satır boşalırsa satırı da kaldır); boyutunu döndür
function detachCard(id) {
  layout.hidden = layout.hidden.filter(x => x !== id);
  const pos = locate(id);
  if (!pos) return null;
  const row = layout.rows[pos.r];
  const [col] = row.cols.splice(pos.c, 1);
  if (!row.cols.length) layout.rows.splice(pos.r, 1);
  return col;
}
// Kartı hedef kartın soluna/sağına (aynı satır) ya da üstüne/altına (yeni satır) yerleştir
function placeCard(id, targetId, zone) {
  if (id === targetId) return;
  detachCard(id);
  const pos = locate(targetId);
  if (!pos) return;
  const row = layout.rows[pos.r];
  if (zone === 'left' || zone === 'right') {
    const avg = row.cols.reduce((s, c) => s + c.size, 0) / row.cols.length;
    row.cols.splice(pos.c + (zone === 'right' ? 1 : 0), 0, { card: id, size: avg });
  } else {
    // Yeni satır, hedef satırın yüksekliğinin yarısını alır (diğer satırlar etkilenmez)
    const half = row.size / 2;
    row.size = half;
    layout.rows.splice(pos.r + (zone === 'below' ? 1 : 0), 0, { size: half, cols: [{ card: id, size: 1 }] });
  }
  saveLayout();
}
function hideCard(id) {
  detachCard(id);
  if (!layout.rows.length) { layout.rows.push({ size: 1, cols: [{ card: id, size: 1 }] }); return saveLayout(); }
  layout.hidden.push(id);
  saveLayout();
}
function showCard(id) {
  detachCard(id);
  layout.rows.push({ size: 1, cols: [{ card: id, size: 1 }] });
  saveLayout();
}

// Her karta düzenleme katmanı: ad, sürükleme ve gizleme
function ensureEditOverlay(id) {
  const card = cardEls[id];
  if (card.querySelector(':scope > .card-edit')) return;
  const ov = document.createElement('div');
  ov.className = 'card-edit';
  ov.draggable = true;
  ov.innerHTML = `<span class="ce-grip">⠿</span><span class="ce-name">${CARDS[id]}</span>
    <span class="ce-hint">Sürükleyip başka bir kartın kenarına bırak</span>
    <button type="button" class="ce-hide" title="Kartı gizle">Gizle</button>`;
  ov.querySelector('.ce-hide').onclick = () => hideCard(id);
  ov.addEventListener('dragstart', e => { dragCard = id; e.dataTransfer.effectAllowed = 'move'; card.classList.add('moving'); });
  ov.addEventListener('dragend', () => { dragCard = null; card.classList.remove('moving'); clearZones(); });
  ov.addEventListener('dragover', e => {
    if (!dragCard || dragCard === id) return;
    e.preventDefault();
    clearZones();
    ov.dataset.zone = dropZone(e, ov);
  });
  ov.addEventListener('dragleave', e => { if (!ov.contains(e.relatedTarget)) delete ov.dataset.zone; });
  ov.addEventListener('drop', e => {
    if (!dragCard || dragCard === id) return;
    e.preventDefault();
    const zone = dropZone(e, ov), moved = dragCard;
    dragCard = null;
    clearZones();
    placeCard(moved, id, zone);
  });
  card.append(ov);
}
// Bırakma bölgesi: üst/alt %28 → yeni satır, aksi halde sol/sağ yarı → aynı satırda yan yana
function dropZone(e, el) {
  const r = el.getBoundingClientRect();
  const y = (e.clientY - r.top) / r.height, x = (e.clientX - r.left) / r.width;
  if (y < 0.28) return 'above';
  if (y > 0.72) return 'below';
  return x < 0.5 ? 'left' : 'right';
}
const clearZones = () => $$('.card-edit[data-zone]').forEach(el => delete el.dataset.zone);

function renderEditTray() {
  const tray = $('#editTray');
  const hidden = layout.hidden;
  tray.innerHTML = hidden.length
    ? `<span class="muted">Gizli kartlar:</span>${hidden.map(id => `<button type="button" data-show="${id}">＋ ${CARDS[id]}</button>`).join('')}`
    : '<span class="muted">Kartı taşımak için sürükle · kenarları sürükleyerek boyutlandır · boşluğa çift tıkla: eşitle</span>';
  tray.querySelectorAll('[data-show]').forEach(b => b.onclick = () => showCard(b.dataset.show));
}
function setEditing(on) {
  if (on && view !== 'dashboard') setView('dashboard');   // düzen yalnızca panoda düzenlenir
  editingLayout = on;
  document.body.classList.toggle('editing', on);
  $('#editLayout').classList.toggle('on', on);
  $('#editLayout').innerHTML = on ? ICON_DONE : ICON_EDIT;
  $('#editLayout').title = on ? 'Düzenlemeyi bitir (Esc)' : 'Düzenle: kartları taşı, gizle, boyutlandır';
  $('#editBar').hidden = !on;
  if (on) { Object.keys(CARDS).forEach(ensureEditOverlay); renderEditTray(); closeCalDay?.(); }
}
$('#editLayout').onclick = () => setEditing(!editingLayout);
$('#layoutReset').onclick = () => { layout = clone(DEFAULT_LAYOUT); layout.compactWeather = !!settings.layout?.compactWeather; saveLayout(); };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && editingLayout) setEditing(false); });

// --- Simgeler (üst çubuk) ---
const svgIcon = d => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON_EDIT = svgIcon('<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><path d="M17 13.5v7M13.5 17h7"/>');
const ICON_DONE = svgIcon('<path d="M5 12.5l4.5 4.5L19 7.5"/>');
const NAV_ICONS = {
  dashboard: svgIcon('<rect x="3.5" y="3.5" width="7" height="9" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.5"/><rect x="3.5" y="15.5" width="7" height="5" rx="1.5"/>'),
  clock: svgIcon('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  spark: svgIcon('<path d="M12 3.5l1.8 5 5 1.8-5 1.8-1.8 5-1.8-5-5-1.8 5-1.8z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>'),
  weather: svgIcon('<circle cx="9" cy="9" r="3.2"/><path d="M9 2.8v1.4M3.6 9H2.2M4.6 4.6l1 1M13.4 4.6l-1 1"/><path d="M8 19.5h9a3.5 3.5 0 0 0 .3-7 4.5 4.5 0 0 0-8.6 1.3A3 3 0 0 0 8 19.5z"/>'),
  calendar: svgIcon('<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  stats: svgIcon('<path d="M4 20h16"/><rect x="6" y="11" width="3" height="6.5" rx="1"/><rect x="10.5" y="6.5" width="3" height="11" rx="1"/><rect x="15" y="9" width="3" height="8.5" rx="1"/>'),
  todos: svgIcon('<path d="M4 6.5l1.5 1.5L8 5.5M4 12.5l1.5 1.5L8 11.5M4 18.5l1.5 1.5L8 17.5M11 7h9M11 13h9M11 19h9"/>'),
  notes: svgIcon('<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4M9 12h6M9 15.5h6"/>'),
};
$('#editLayout').innerHTML = ICON_EDIT;

// --- Görünüm: pano ya da tek kart tam ekran ---
// Üst çubuktaki gezinme düğmeleri ve her kartın başlığındaki ⤢ düğmesi aynı işi yapar.
const FS_OPEN = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const FS_CLOSE = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';
function setView(id) {
  view = id in CARDS ? id : 'dashboard';
  document.body.classList.toggle('solo', view !== 'dashboard');
  applyLayout();
}
function renderNav() {
  const items = [['dashboard', 'Pano'], ...Object.entries(CARDS)];
  const icons = !!settings.navIcons;
  $('#viewNav').classList.toggle('icons', icons);
  $('#viewNav').innerHTML = items.map(([id, name]) =>
    `<button type="button" data-view="${id}" class="${id === view ? 'on' : ''}" title="${esc(name)}">${icons ? NAV_ICONS[id] : esc(name)}</button>`).join('');
}
$('#viewNav').onclick = e => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); };
// Her kartın başlık satırının sağına tam ekran düğmesi (bir kez eklenir; simgesi görünüme göre değişir)
function addFullscreenButtons() {
  for (const id of Object.keys(CARDS)) {
    const head = cardEls[id]?.querySelector('.card-head');
    if (!head) continue;
    let btn = head.querySelector('.fs-btn');
    if (!btn) {
      let actions = head.querySelector(':scope > .actions');
      if (!actions) {
        // Başlıktan başka öğeler (ör. Notlar'daki ＋) varsa onları da sağdaki gruba al
        actions = document.createElement('div');
        actions.className = 'actions';
        [...head.children].filter(c => c.tagName !== 'H2').forEach(c => actions.append(c));
        head.append(actions);
      }
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'icon-btn fs-btn';
      btn.onclick = () => setView(view === id ? 'dashboard' : id);
      actions.append(btn);
    }
    const open = view === id;
    btn.innerHTML = open ? FS_CLOSE : FS_OPEN;
    btn.title = open ? 'Panoya dön' : 'Tam ekran';
  }
}

// Ayarlar → Kartlar
function renderLayoutSettings() { $('#compactWeather').checked = !!layout?.compactWeather; $('#navIcons').checked = !!settings.navIcons; }
$('#navIcons').onchange = async e => { settings = await api.settings.set({ navIcons: e.target.checked }); renderNav(); };
$('#compactWeather').onchange = e => { layout.compactWeather = e.target.checked; saveLayout(); };
$('#editLayoutFromSettings').onclick = () => { $('#settingsDlg').close(); setEditing(true); };
$('#layoutResetFromSettings').onclick = () => { $('#layoutReset').click(); };
