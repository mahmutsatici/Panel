// ============ Kart düzeni ============
// Satır tabanlı ızgara: her satırda bir ya da birden fazla kart yan yana durur
// (ör. üstte 3 sütun, altta 2 sütun). Boyutlar oransaldır:
//   · satır.size → satırın yüksekliği (diğer satırlara oranla)
//   · kart.size  → kartın satır içindeki genişliği (yanındakilere oranla)
// Kartların arasındaki boşluklar her zaman sürüklenebilir (genişlik / yükseklik ayarı).
// Üst çubuktaki "Düzenle" ile kartlar taşınır, gizlenir ve geri eklenir.
const CARDS = {
  clock: 'Saat',
  weather: 'Hava durumu',
  calendar: 'Takvim',
  stats: 'Özet',
  todos: 'Yapılacaklar',
  notes: 'Notlar',
};
const DEFAULT_LAYOUT = {
  v: 2,
  rows: [
    { size: 1.35, cols: [{ card: 'clock', size: 1 }, { card: 'weather', size: 2.3 }, { card: 'stats', size: 1.5 }] },
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
  // Yeni eklenmiş (düzende hiç olmayan) kartlar en alta yeni satır olarak gelir
  const missing = Object.keys(CARDS).filter(id => !seen.has(id));
  if (missing.length) l.rows.push({ size: 1, cols: missing.map(card => ({ card, size: 1 })) });
  if (!l.rows.length) return clone(DEFAULT_LAYOUT);
  return l;
}
let layout = null;   // geçerli düzen (normalize edilmiş)
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
  editingLayout = on;
  document.body.classList.toggle('editing', on);
  $('#editLayout').classList.toggle('on', on);
  $('#editLayout').textContent = on ? '✓ Bitti' : '▦ Düzenle';
  $('#editBar').hidden = !on;
  if (on) { Object.keys(CARDS).forEach(ensureEditOverlay); renderEditTray(); closeCalDay?.(); }
}
$('#editLayout').onclick = () => setEditing(!editingLayout);
$('#layoutReset').onclick = () => { layout = clone(DEFAULT_LAYOUT); layout.compactWeather = !!settings.layout?.compactWeather; saveLayout(); };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && editingLayout) setEditing(false); });

// Ayarlar → Kartlar
function renderLayoutSettings() { $('#compactWeather').checked = !!layout?.compactWeather; }
$('#compactWeather').onchange = e => { layout.compactWeather = e.target.checked; saveLayout(); };
$('#editLayoutFromSettings').onclick = () => { $('#settingsDlg').close(); setEditing(true); };
$('#layoutResetFromSettings').onclick = () => { $('#layoutReset').click(); };
