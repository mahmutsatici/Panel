// ============ Notlar (notes/*.md) ============
// · Notların sırası settings.json → noteOrder içinde tutulur; listede sürükle-bırak ile değiştirilir.
// · Arama hem başlıkta hem içerikte yapılır; eşleşen satır listede gösterilir.
// · Yapıştırılan / sürüklenen resimler notes/resimler/ klasörüne kaydedilir, notta göreli yolla durur.
let notes = [];
let current = null;      // açık notun adı
let baseline = '';       // editörün yüklendiği andaki markdown'u (gereksiz kaydı önler)
let lastFile = '';       // diskte en son okunan/yazılan içerik (dışarıdan değişikliği algılar)
let dirty = false;
let loadingNote = false;
let searchHits = null;   // arama yapılırken: Map(ad → { snippet, nameHit })
let editor = null;
const fmtNoteDate = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Editör, kartlar yerine yerleştikten sonra oluşturulur (araç çubuğu genişliği doğru ölçülsün)
function createEditor() {
  editor = new ToastEditor({
    el: $('#noteEditor'),
    height: '100%',
    initialEditType: 'wysiwyg',
    hideModeSwitch: true,
    language: 'tr-TR',
    usageStatistics: false,
    autofocus: false,
    placeholder: 'Yazmaya başla… (resim yapıştırabilir ya da sürükleyebilirsin)',
    toolbarItems: [
      ['heading', 'bold', 'italic', 'strike'],
      ['ul', 'ol', 'task'],
      ['code', 'codeblock'],
      ['quote', 'link', 'table'],
    ],
    hooks: {
      // Resim yapıştırma / sürükleme → dosyaya kaydet, nota göreli yolu ekle
      async addImageBlobHook(blob, callback) {
        try {
          const rel = await api.notes.saveImage(new Uint8Array(await blob.arrayBuffer()), blob.type);
          callback(rel, '');
        } catch (err) {
          alert('Resim eklenemedi: ' + (err.message || err));
        }
      },
    },
  });

  editor.on('change', () => {
    if (loadingNote || !current) return;
    dirty = true;
    $('#saveState').textContent = 'Yazılıyor…';
    saveSoon();
  });
  editor.on('caretChange', refreshTableButton);
  editor.on('change', () => { refreshImageSizes(); followImageTarget(); });
  setupToolbarToggles();
  setupImageResize();
}

// ============ Resim boyutu ============
// Genişlik, resmin alt metninde Obsidian biçimiyle tutulur: ![resim|300](resimler/x.png)
// Editör resim öğelerine doğrudan dokunulmasını sevmediği için genişlikler ayrı bir stil kuralıyla uygulanır.
const IMG_W_RE = /\|(\d{2,4})$/;
// Görsel editördeki gerçek resimler (gizli Markdown görünümü ve ProseMirror'ın imleç yardımcısı hariç)
const WW_IMG = '#noteEditor .toastui-editor-ww-container img:not(.ProseMirror-separator)';
const imgStyle = document.createElement('style');
document.head.append(imgStyle);
let resizeCss = '';   // sürükleme sırasında geçici kural
function refreshImageSizes() {
  const widths = new Set();
  $$(WW_IMG).forEach(im => { const m = (im.getAttribute('alt') || '').match(IMG_W_RE); if (m) widths.add(m[1]); });
  imgStyle.textContent = [...widths].map(w => `${WW_IMG}[alt$="|${w}"]{width:${w}px}`).join('\n') + resizeCss;
}

let imgTarget = null;
const imgBar = document.createElement('div');
imgBar.className = 'img-bar';
imgBar.hidden = true;
imgBar.innerHTML = `
  <button type="button" data-p="25">Küçük</button>
  <button type="button" data-p="50">Orta</button>
  <button type="button" data-p="75">Büyük</button>
  <button type="button" data-p="100">Tam genişlik</button>
  <button type="button" data-p="0" title="Resmin kendi boyutu">Orijinal</button>
  <span class="img-w"></span>`;
const imgHandle = document.createElement('div');
imgHandle.className = 'img-handle';
imgHandle.hidden = true;
imgHandle.title = 'Sürükleyerek boyutlandır';
document.body.append(imgBar, imgHandle);

// Görsel (WYSIWYG) editörün yazı alanı genişliği (gizli Markdown editörü değil)
function contentWidth() {
  const pm = $('#noteEditor .toastui-editor-ww-container .ProseMirror');
  const cs = getComputedStyle(pm);
  return Math.max(120, pm.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
}
function positionImageBar() {
  if (!imgTarget || !imgTarget.isConnected) return hideImageBar();
  const r = imgTarget.getBoundingClientRect();
  imgBar.hidden = imgHandle.hidden = false;
  imgBar.style.left = `${Math.max(8, r.left)}px`;
  imgBar.style.top = `${Math.max(8, r.top - imgBar.offsetHeight - 6)}px`;
  imgHandle.style.left = `${r.right - 7}px`;
  imgHandle.style.top = `${r.bottom - 7}px`;
  const m = (imgTarget.getAttribute('alt') || '').match(IMG_W_RE);
  imgBar.querySelector('.img-w').textContent = m ? `${m[1]} px` : 'orijinal';
}
function hideImageBar() { imgBar.hidden = imgHandle.hidden = true; imgTarget = null; }
// Editör resmi yeniden çizdiyse (ör. boyut değişince) aynı resmi bulup araç çubuğunu ona taşı
function followImageTarget() {
  if (!imgTarget || imgTarget.isConnected) return imgTarget && positionImageBar();
  const src = imgTarget.getAttribute('src');
  imgTarget = $$(WW_IMG).find(x => x.getAttribute('src') === src) || null;
  imgTarget ? positionImageBar() : hideImageBar();
}

// Resmin alt metnindeki genişliği değiştir (0 → orijinal boyut)
function setImageWidth(img, width) {
  const view = pmView();
  if (!view) return;
  let pos = view.posAtDOM(img, 0);
  let node = view.state.doc.nodeAt(pos);
  if (node?.type.name !== 'image') { pos -= 1; node = view.state.doc.nodeAt(pos); }
  if (node?.type.name !== 'image') return;
  // Önceki genişlik(ler)i at: "resim|300" → "resim"
  const base = (node.attrs.altText || '').replace(/(\|-?\d*)+$/, '').trim() || 'resim';
  const altText = width ? `${base}|${Math.round(width)}` : base;
  view.dispatch(view.state.tr.setNodeMarkup(pos, null, { ...node.attrs, altText }));
}

// Resmi büyüt: tıklayınca pencereyi kaplayan görüntü açılır; tıklama ya da Esc kapatır
const lightbox = document.createElement('div');
lightbox.className = 'lightbox';
lightbox.hidden = true;
lightbox.title = 'Kapatmak için tıkla (Esc)';
lightbox.innerHTML = '<img alt="">';
document.body.append(lightbox);
lightbox.onclick = () => { lightbox.hidden = true; };
document.addEventListener('keydown', e => { if (e.key === 'Escape') lightbox.hidden = true; });

// Boyut araç çubuğu artık fareyle resmin üstüne gelince görünür (tıklama büyütmeye ayrıldı)
let barHideTimer = null, resizingImage = false;
function scheduleBarHide() {
  clearTimeout(barHideTimer);
  barHideTimer = setTimeout(() => { if (!resizingImage) hideImageBar(); }, 350);
}

function setupImageResize() {
  const root = $('#noteEditor');
  root.addEventListener('click', e => {
    const img = e.target.closest(WW_IMG);
    if (!img) return;
    lightbox.querySelector('img').src = img.src;
    lightbox.hidden = false;
  });
  root.addEventListener('mouseover', e => {
    const img = e.target.closest(WW_IMG);
    if (!img) return;
    clearTimeout(barHideTimer);
    imgTarget = img;
    positionImageBar();
  });
  root.addEventListener('mouseout', e => { if (e.target.closest(WW_IMG)) scheduleBarHide(); });
  for (const el of [imgBar, imgHandle]) {
    el.addEventListener('mouseenter', () => clearTimeout(barHideTimer));
    el.addEventListener('mouseleave', scheduleBarHide);
  }
  root.querySelector('.toastui-editor-ww-container')?.addEventListener('scroll', () => imgTarget && positionImageBar(), true);
  document.addEventListener('mousedown', e => {
    if (imgTarget && !e.target.closest('.img-bar, .img-handle') && e.target !== imgTarget) hideImageBar();
  });
  window.addEventListener('resize', () => imgTarget && positionImageBar());
  imgBar.querySelectorAll('[data-p]').forEach(b => b.onclick = () => {
    const img = imgTarget, p = Number(b.dataset.p);
    setImageWidth(img, p ? (contentWidth() * p) / 100 : 0);
    requestAnimationFrame(() => { refreshImageSizes(); followImageTarget(); });
  });
  // Köşe tutamacı: sürükledikçe önizle, bırakınca kaydet
  imgHandle.addEventListener('mousedown', e => {
    e.preventDefault();
    resizingImage = true;
    const img = imgTarget, startX = e.clientX, startW = img.getBoundingClientRect().width;
    const sel = `${WW_IMG}[src="${CSS.escape(img.getAttribute('src'))}"]`;
    let w = startW;
    const move = ev => {
      w = Math.max(40, Math.min(contentWidth(), startW + ev.clientX - startX));
      resizeCss = `\n${sel}{width:${Math.round(w)}px !important}`;
      refreshImageSizes();
      positionImageBar();
      imgBar.querySelector('.img-w').textContent = `${Math.round(w)} px`;
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      resizingImage = false;
      setImageWidth(img, w);
      resizeCss = '';
      requestAnimationFrame(() => { refreshImageSizes(); followImageTarget(); });
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

// Sıralama: kayıtlı sıradakiler o sırayla; sırada olmayan (yeni / dışarıdan eklenen) notlar en üstte.
function orderNotes(list) {
  const order = settings.noteOrder || [];
  const pos = new Map(order.map((n, i) => [n, i]));
  const known = list.filter(n => pos.has(n.name)).sort((a, b) => pos.get(a.name) - pos.get(b.name));
  const fresh = list.filter(n => !pos.has(n.name)).sort((a, b) => b.mtime - a.mtime);
  return [...fresh, ...known];
}
async function saveNoteOrder() {
  settings = await api.settings.set({ noteOrder: notes.map(n => n.name) });
}

async function loadNoteList() {
  notes = orderNotes(await api.notes.list());
  if (searchHits) await runSearch(); else renderNoteList();
}

// --- Tam metin arama ---
async function runSearch() {
  const q = $('#noteSearch').value.trim();
  if (!q) { searchHits = null; renderNoteList(); return; }
  const hits = await api.notes.search(q);
  if ($('#noteSearch').value.trim() !== q) return;   // bu arada yazı değiştiyse eski sonucu gösterme
  searchHits = new Map(hits.map(h => [h.name, h]));
  renderNoteList();
}
$('#noteSearch').addEventListener('input', debounce(runSearch, 150));
$('#noteSearch').addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.target.value = ''; runSearch(); }
  if (e.key === 'Enter') { const first = $('#noteList li'); first?.click(); }
});

function renderNoteList() {
  const q = $('#noteSearch').value.trim();
  const ul = $('#noteList');
  ul.innerHTML = '';
  const list = searchHits ? notes.filter(n => searchHits.has(n.name)) : notes;
  for (const n of list) {
    const hit = searchHits?.get(n.name);
    const li = document.createElement('li');
    li.className = n.name === current ? 'active' : '';
    li.draggable = !searchHits;
    li.title = searchHits ? '' : 'Sürükleyerek sırala';
    li.innerHTML = `<div class="n">${highlight(n.name, hit ? q : '')}</div>`
      + (hit?.snippet ? `<div class="snip">${highlight(hit.snippet, q)}</div>` : `<div class="m">${fmtNoteDate.format(new Date(n.mtime))}</div>`)
      + '<button class="nd" title="Notu sil">🗑</button>';
    li.onclick = () => openNote(n.name);
    li.querySelector('.nd').onclick = e => { e.stopPropagation(); deleteNote(n.name); };
    li.addEventListener('dragstart', e => { dragging = { type: 'note', name: n.name }; e.dataTransfer.effectAllowed = 'move'; li.classList.add('dragging'); });
    li.addEventListener('dragend', endDrag);
    li.addEventListener('dragover', e => {
      if (dragging?.type !== 'note') return;
      e.preventDefault();
      clearDropMarks();
      if (dragging.name !== n.name) li.classList.add(upperHalf(e, li) ? 'drop-before' : 'drop-after');
    });
    li.addEventListener('drop', e => {
      if (dragging?.type !== 'note') return;
      e.preventDefault();
      const from = notes.findIndex(x => x.name === dragging.name);
      if (from === -1 || dragging.name === n.name) return endDrag();
      const before = upperHalf(e, li);
      const [moved] = notes.splice(from, 1);
      notes.splice(notes.findIndex(x => x.name === n.name) + (before ? 0 : 1), 0, moved);
      endDrag();
      renderNoteList();
      saveNoteOrder();
    });
    ul.append(li);
  }
  if (searchHits && !list.length) ul.innerHTML = '<li class="no-hit">Sonuç yok</li>';
  $('#noteMain').classList.toggle('disabled', !current);
}

function setEditorContent(md) {
  loadingNote = true;
  editor.setMarkdown(md, false);
  baseline = editor.getMarkdown();
  dirty = false;
  hideImageBar();
  refreshImageSizes();
  // Resimler yüklendikçe de (src çözülünce) boyutlar uygulanmış olsun
  setTimeout(() => { loadingNote = false; refreshImageSizes(); }, 0);
}

async function openNote(name) {
  await saveNote();
  await saving;   // süren bir otomatik kayıt varsa bitsin, sonra oku
  current = name;
  lastFile = await api.notes.read(name);
  $('#noteTitle').value = name;
  setEditorContent(lastFile);
  $('#saveState').textContent = '';
  store.set('lastNote', name);
  renderNoteList();
}

async function saveNote() {
  if (!current || !dirty) return;
  const name = current, content = editor.getMarkdown();
  dirty = false;
  if (content === baseline) return;
  const write = api.notes.write(name, content);
  saving = write.catch(() => {});
  await write;
  baseline = lastFile = content;
  $('#saveState').textContent = 'Kaydedildi ✓';
  const n = notes.find(x => x.name === name);
  if (n) { n.mtime = Date.now(); if (!searchHits) renderNoteList(); }
}
const saveSoon = debounce(saveNote, 600);
let saving = Promise.resolve();   // süren not kaydı (okumalar bunu bekler)

// --- Araç çubuğu: aynı düğmeye ikinci kez tıklayınca biçimi kaldır ---
// Toast UI liste/alıntı/kod bloğu düğmeleri tek yönlü çalışıyor; burada geri alma davranışını ekliyoruz.
const pmView = () => editor && editor.wwEditor && editor.wwEditor.view;
function ancestor(state, test) {
  const $f = state.selection.$from;
  for (let d = $f.depth; d > 0; d--) if (test($f.node(d))) return { node: $f.node(d), depth: d, pos: $f.before(d) };
  return null;
}
function listKind(state) {
  const list = ancestor(state, n => n.type.name === 'bulletList' || n.type.name === 'orderedList');
  if (!list) return null;
  const item = ancestor(state, n => n.type.name === 'listItem');
  if (item && item.node.attrs.task) return 'task';
  return list.node.type.name === 'orderedList' ? 'ol' : 'ul';
}
function liftOut(view, test) {
  // Seçili blok(lar)ı, test'i sağlayan sarmalayıcıdan tamamen çıkana kadar yukarı taşı
  for (let i = 0; i < 10 && ancestor(view.state, test); i++) {
    if (!PM.lift(view.state, view.dispatch)) break;
  }
}
function unwrapCodeBlock(view) {
  const cb = ancestor(view.state, n => n.type.name === 'codeBlock');
  if (!cb) return;
  const { schema } = view.state;
  const paras = cb.node.textContent.split('\n').map(line => schema.nodes.paragraph.create(null, line ? schema.text(line) : null));
  const tr = view.state.tr.replaceWith(cb.pos, cb.pos + cb.node.nodeSize, paras);
  tr.setSelection(PM.TextSelection.near(tr.doc.resolve(cb.pos + 1)));
  view.dispatch(tr);
}
function removeInlineCode(view) {
  const { state } = view;
  const type = state.schema.marks.code;
  const { from, to, empty, $from } = state.selection;
  if (!empty) {
    if (!state.doc.rangeHasMark(from, to, type)) return false;
    view.dispatch(state.tr.removeMark(from, to, type));
    return true;
  }
  // İmleç bir kod parçasının içindeyse o parçanın tamamından kod biçimini kaldır
  const parent = $from.parent, base = $from.start();
  const has = i => i >= 0 && i < parent.childCount && type.isInSet(parent.child(i).marks);
  let idx = $from.index();
  if (!has(idx)) idx -= 1;
  if (!has(idx)) return false;
  let s = idx, e = idx;
  while (has(s - 1)) s--;
  while (has(e + 1)) e++;
  let start = base;
  for (let i = 0; i < s; i++) start += parent.child(i).nodeSize;
  let end = start;
  for (let i = s; i <= e; i++) end += parent.child(i).nodeSize;
  view.dispatch(state.tr.removeMark(start, end, type).removeStoredMark(type));
  return true;
}

// Düğme sınıfı → [aktif mi?, kaldır]
const TOGGLES = {
  'bullet-list': [s => listKind(s) === 'ul', v => liftOut(v, n => n.type.name === 'bulletList')],
  'ordered-list': [s => listKind(s) === 'ol', v => liftOut(v, n => n.type.name === 'orderedList')],
  'task-list': [s => listKind(s) === 'task', v => liftOut(v, n => n.type.name === 'bulletList' || n.type.name === 'orderedList')],
  'quote': [s => !!ancestor(s, n => n.type.name === 'blockQuote'), v => liftOut(v, n => n.type.name === 'blockQuote')],
  'codeblock': [s => !!ancestor(s, n => n.type.name === 'codeBlock'), unwrapCodeBlock],
  'code': [s => {
    const t = s.schema.marks.code, { from, to, empty, $from } = s.selection;
    return empty ? !!t.isInSet(s.storedMarks || $from.marks()) : s.doc.rangeHasMark(from, to, t);
  }, removeInlineCode],
  // İmleç tablodayken tablo düğmesi tabloyu siler
  'table': [s => !!ancestor(s, n => n.type.name === 'table'), () => editor.exec('removeTable')],
};
function toggleFor(btn) {
  const view = pmView();
  if (!btn || !view || !editor.isWysiwygMode()) return null;
  const key = Object.keys(TOGGLES).find(k => btn.classList.contains(k));
  return key && TOGGLES[key][0](view.state) ? TOGGLES[key][1] : null;
}
function setupToolbarToggles() {
  const toolbarEl = $('#noteEditor .toastui-editor-defaultUI-toolbar');
  let pendingToggle = null;
  toolbarEl.addEventListener('mousedown', e => {
    const btn = e.target.closest('button');
    pendingToggle = toggleFor(btn) ? btn : null;
    if (pendingToggle) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  toolbarEl.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn || btn !== pendingToggle) return;
    e.preventDefault();
    e.stopPropagation();
    pendingToggle = null;
    const fn = toggleFor(btn);
    if (fn) { fn(pmView()); editor.focus(); }
  }, true);
}

// Tablo düğmesinin ipucu ve görünümü: imleç tablodaysa "Tabloyu sil"
function refreshTableButton() {
  const btn = $('#noteEditor .toastui-editor-defaultUI-toolbar button.table');
  const view = pmView();
  if (!btn || !view) return;
  const inTable = !!ancestor(view.state, n => n.type.name === 'table');
  btn.classList.toggle('active', inTable);
  btn.setAttribute('aria-label', inTable ? 'Tabloyu sil' : 'Tablo ekle');
  btn.title = inTable ? 'Tabloyu sil (tekrar tıkla)' : '';
}

async function renameCurrent() {
  const to = $('#noteTitle').value.trim();
  if (!current || !to || to === current) { $('#noteTitle').value = current || ''; return; }
  await saveNote();
  try {
    const old = current;
    current = await api.notes.rename(old, to);
    const n = notes.find(x => x.name === old);
    if (n) n.name = current;
    await saveNoteOrder();
    $('#noteTitle').value = current;
    store.set('lastNote', current);
    await loadNoteList();
  } catch {
    $('#noteTitle').value = current;
    alert('Bu ad kullanılamıyor.');
  }
}
$('#noteTitle').addEventListener('blur', renameCurrent);
$('#noteTitle').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); editor.focus(); } });

$('#newNote').onclick = async () => {
  const name = await api.notes.create('Yeni not');
  $('#noteSearch').value = '';
  searchHits = null;
  await loadNoteList();          // yeni not sırada olmadığı için en üste gelir
  await saveNoteOrder();
  await openNote(name);
  $('#noteTitle').select();
  $('#noteTitle').focus();
};

// Silme = pasif yapma: dosya yerinde kalır, ilk satırına <!-- silindi: ... --> eklenir.
async function deleteNote(name) {
  if (!name || !confirm(`"${name}" notu silinsin mi?\n\n(Silinenler penceresinden ya da notes klasöründeki dosyasından geri getirebilirsin.)`)) return;
  if (name === current) await saveNote();
  await api.notes.remove(name);
  const wasOpen = name === current;
  if (wasOpen) current = null;
  await loadNoteList();
  await saveNoteOrder();
  if (!wasOpen) return;
  if (notes[0]) openNote(notes[0].name);
  else { $('#noteTitle').value = ''; setEditorContent(''); renderNoteList(); }
}
$('#deleteNote').onclick = () => deleteNote(current);

// Ctrl+S: notu hemen kaydet
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); saveNote(); }
});
