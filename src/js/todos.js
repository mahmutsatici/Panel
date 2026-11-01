// ============ Yapılacaklar (todo.md) ============
// Dosya biçimi:
//   # Yapılacaklar
//   ## İş
//   - [ ] rapor yaz 📅 2026-10-10 <!-- eklendi:2026-10-05T15:40 -->
//   - [x] toplantı 📅 2026-10-04 <!-- eklendi:2026-10-01T09:00 tamamlandı:2026-10-04T11:30 -->
//   ## Ev
//   ...
// · Dosyadaki sıra = ekrandaki sıra (yapılmamışlar üstte, yapılmışlar altta). Sürükle-bırak ile değişir.
// · Alt görev = 2 boşluk girintili madde (en fazla 3 seviye):
//   - [ ] analiz yapılacak
//     - [ ] masraf analizi
// · "📅 YYYY-AA-GG" son tarihtir (Obsidian Tasks ile aynı biçim); "⏰ SS:DD" görevin saati; "🔔 0dk,15dk,2026-11-05T09:00" hatırlatıcılar.
// · <!-- eklendi:… tamamlandı:… --> arka planda tutulan zaman bilgisidir; Markdown'da görünmez.
// · Silme = pasif yapma. Satır kalır, sonuna <!-- silindi: … --> eklenir; bu işaret silinince geri gelir.
//   Kategori silinirse başlığına eklenir: ## Eski kategori <!-- silindi: … -->
const TASK_RE = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;
const DEL_RE = /\s*<!--\s*silindi\b[^>]*-->\s*$/i;
const DEL_AT_RE = /<!--\s*silindi:?\s*([^>]*?)\s*-->/i;
const META_RE = /\s*<!--\s*((?:eklendi|tamamlandı):[^>]*?)\s*-->/u;
const DUE_RE = /\s*📅\s*(\d{4}-\d{2}-\d{2})/u;
const TIME_RE = /\s*⏰\s*(\d{1,2}:\d{2})/u;
const REMIND_LINE_RE = /\s*🔔\s*([^⏰📅🔁<]*?)\s*(?=⏰|📅|🔁|<!--|$)/u;
const REC_RE = /\s*🔁\s*([^📅<]*?)\s*(?=📅|<!--|$)/u;
const deletedMark = () => `<!-- silindi: ${new Date().toLocaleString('sv-SE').slice(0, 16)} -->`;
const GENERAL = 'Genel';
const newCat = name => ({ name, tasks: [], hidden: [] });
const activeCats = () => todo.cats.filter(c => !c.deleted);
let todo = { head: '# Yapılacaklar', cats: [] };
let showDone = store.get('showDone', true);
let mineOnly = store.get('mineOnly', false);   // yalnızca bana atanan ortak görevler
let collapsed = new Set(store.get('collapsedCats', []));
let selectedCat = store.get('lastCatName', null);
// Açık bekleyen "yeni görev" satırı (henüz dosyada değil): { cat, after, due, rec, text, manual }
//   after = null → kategorinin en üstüne, after = görev → o görevin hemen altına eklenir
let pendingNew = null;
let pendingFocus = false;   // sıradaki çizimde yeni satırın girişine odaklan

// Kategori noktasının rengi, yapılmamış görev sayısına göre (renkler temadan gelir):
//   0 → yeşil · 1–4 → sarı · 5–9 → turuncu · 10+ → kırmızı
const LOAD_LEVELS = [[10, 'var(--load-3)'], [5, 'var(--load-2)'], [1, 'var(--load-1)'], [0, 'var(--load-0)']];
const openCountOf = cat => cat.tasks.filter(t => !t.done).length;
const catColor = cat => { const n = openCountOf(cat); return LOAD_LEVELS.find(([min]) => n >= min)[1]; };
const loadTitle = cat => { const n = openCountOf(cat); return n ? `${n} yapılmamış görev` : 'Hepsi tamam'; };

// Ortak kategorinin 👥 ipucu: üyeler (adı biliniyorsa ad, yoksa e-posta)
const sharedTitle = cat => `Ortak kategori · ${cat.uyeler.map(e => cat.uyeAdlari[e] || e).join(', ')}`;

const partition = tasks => [...tasks.filter(t => !t.done), ...tasks.filter(t => t.done)];

// ---- Alt görevler (ağaç) ----
// Kategorinin görevleri düz listede durur; her görevin level'ı (0–2) vardır. Bir görevin alt görevleri, kendisinden sonra
// gelen ve daha derin seviyedeki ardışık görevlerdir ("blok"). Ortak kategorilerde level yoktur (hepsi 0).
const MAX_LEVEL = 2;
const lvl = t => t.level || 0;
const blockEnd = (tasks, i) => { let j = i + 1; while (j < tasks.length && lvl(tasks[j]) > lvl(tasks[i])) j++; return j; };
const parentOf = (tasks, i) => { for (let j = i - 1; j >= 0; j--) if (lvl(tasks[j]) < lvl(tasks[i])) return tasks[j]; return null; };
const blockOf = (cat, task) => { const i = cat.tasks.indexOf(task); return cat.tasks.slice(i, blockEnd(cat.tasks, i)); };
// Seviyeleri geçerli kıl: ilk görev 0, her görev en fazla bir öncekinin bir altı
function fixLevels(tasks) {
  let prev = -1;
  for (const t of tasks) {
    const l = Math.max(0, Math.min(lvl(t), prev + 1, MAX_LEVEL));
    if (l) t.level = l; else delete t.level;
    prev = l;
  }
  return tasks;
}
// Kategori görevlerini sırala: her seviyede kardeşler arasında yapılmamışlar üstte, yapılmışlar altta; alt görevler üstüyle birlikte kalır
function sortTree(tasks) {
  const sort = list => {
    const blocks = [];
    for (let i = 0; i < list.length;) {
      const e = blockEnd(list, i);
      blocks.push([list[i], ...sort(list.slice(i + 1, e))]);
      i = e;
    }
    return [...blocks.filter(b => !b[0].done), ...blocks.filter(b => b[0].done)].flat();
  };
  return sort(fixLevels(tasks));
}
// Bloğu üst görevinin (parent; null = kategori) altına koy: yapılmamış → en üste, yapılmış → yapılmışların en üstüne
function reinsert(cat, block, parent) {
  const t = cat.tasks, L = lvl(block[0]);
  const pi = parent ? t.indexOf(parent) : -1;
  const start = pi + 1, end = parent ? blockEnd(t, pi) : t.length;
  let at = block[0].done ? end : start;
  if (block[0].done) for (let j = start; j < end; j++) if (lvl(t[j]) === L && t[j].done) { at = j; break; }
  t.splice(at, 0, ...block);
}
// Bloğun seviyesini kaydır (kök görev "level" olsun); alt görevler göreli olarak taşınır
function setBlockLevel(block, level) {
  const shift = level - lvl(block[0]);
  for (const t of block) { const l = Math.max(0, Math.min(MAX_LEVEL, lvl(t) + shift)); if (l) t.level = l; else delete t.level; }
}

// "- [ ] …" satırının gövdesinden metin, son tarih ve zaman bilgisini ayır
function parseTaskBody(body) {
  const task = { text: body };
  const meta = body.match(META_RE);
  if (meta) {
    for (const [, k, v] of meta[1].matchAll(/(eklendi|tamamlandı):(\S+)/gu)) {
      if (k === 'eklendi') task.created = v; else task.completed = v;
    }
    body = body.replace(META_RE, '');
  }
  const due = body.match(DUE_RE);
  if (due) { task.due = due[1]; body = body.replace(DUE_RE, ''); }
  const time = body.match(TIME_RE);
  if (time) { task.time = time[1].padStart(5, '0'); body = body.replace(TIME_RE, ''); }
  const remind = body.match(REMIND_LINE_RE);
  if (remind) {
    const toks = remind[1].split(',').map(s => s.trim()).filter(t => REMIND_RE.test(t));
    if (toks.length) task.remind = toks;
    body = body.replace(REMIND_LINE_RE, '');
  }
  const rec = body.match(REC_RE);
  if (rec && normalizeRec(rec[1])) { task.rec = normalizeRec(rec[1]); body = body.replace(REC_RE, ''); }
  task.text = body.trim();
  return task;
}
function parseTaskLine(line) {
  const t = line.match(TASK_RE);
  if (!t) return null;
  const level = Math.min(MAX_LEVEL, Math.floor(line.match(/^\s*/)[0].replace(/	/g, '  ').length / 2));
  return { done: t[1] !== ' ', ...(level ? { level } : {}), ...parseTaskBody(t[2]) };
}
function taskLine(t) {
  let s = `- [${t.done ? 'x' : ' '}] ${t.text}`;
  if (t.rec) s += ` 🔁 ${t.rec}`;
  if (t.due) s += ` 📅 ${t.due}`;
  if (t.time) s += ` ⏰ ${t.time}`;
  if (t.remind?.length) s += ` 🔔 ${t.remind.join(',')}`;
  const meta = [];
  if (t.created) meta.push(`eklendi:${t.created}`);
  if (t.done && t.completed) meta.push(`tamamlandı:${t.completed}`);
  if (meta.length) s += ` <!-- ${meta.join(' ')} -->`;
  return s;
}

function parseTodos(text) {
  const loose = newCat(GENERAL);  // başlıktan önceki (kategorisiz) görevler → "Genel"
  const cats = [];
  let head = null, cur = null;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const h1 = line.match(/^#\s+(.*)$/);
    const h = line.match(/^#{2,6}\s+(.*)$/);
    const t = line.match(TASK_RE);
    if (h1 && head === null && !cur && !loose.tasks.length && !loose.hidden.length) head = line;
    else if (h) {
      const name = h[1].replace(DEL_RE, '').trim();
      if (DEL_RE.test(h[1])) {
        // Pasif kategori: olduğu gibi saklanır, gösterilmez
        cur = { ...newCat(name), deleted: true, mark: h[1].match(DEL_RE)[0].trim() };
        cats.push(cur);
      } else {
        cur = cats.find(c => !c.deleted && c.name === name) || (cats.push(newCat(name)), cats[cats.length - 1]);
      }
    } else if (t) {
      const target = cur || loose;
      if (DEL_RE.test(t[2])) target.hidden.push(line.trim());
      else target.tasks.push(parseTaskLine(line));
    }
  }
  if (loose.tasks.length || loose.hidden.length) {
    const g = cats.find(c => !c.deleted && c.name === GENERAL);
    if (g) { g.tasks.unshift(...loose.tasks); g.hidden.push(...loose.hidden); } else cats.unshift(loose);
  }
  if (!cats.some(c => !c.deleted)) cats.unshift(newCat(GENERAL));
  for (const c of cats) if (!c.deleted) c.tasks = sortTree(c.tasks);
  return { head: head || '# Yapılacaklar', cats };
}

function serializeTodos() {
  const out = [todo.head, ''];
  for (const c of todo.cats) {
    if (c.shared) continue;   // ortak kategoriler buluttadır, todo.md'ye yazılmaz
    out.push(c.deleted ? `## ${c.name} ${c.mark}` : `## ${c.name}`);
    for (const t of c.tasks) out.push('  '.repeat(lvl(t)) + taskLine(t));
    out.push(...c.hidden, '');
  }
  return out.join('\n');
}

async function loadTodos() {
  const parsed = parseTodos(await api.todos.read());
  const shared = sharedCats();   // ortak kategoriler dosyadan gelmez; okuma sürerken gelenler de korunsun
  todo = parsed;
  shared.forEach(placeShared);
  renderTodos();
}
async function saveTodos() {
  pushShared();
  saveCatOrder();
  renderTodos();
  await api.todos.write(serializeTodos());
}

// Yapılmamış → en üste; yapılmış → yapılmışların en üstüne (üst seviyede).
function insertTask(cat, task) { reinsert(cat, [task], null); }
// Sürüklenen görev (alt görevleriyle birlikte, "blok"): aynı kategoride ya da iki yerel kategori arasında taşınır;
// ortak kategoriyle yerel arasında yalnızca görevin kendisi kopyalanır
function takeBlock(d, dest) {
  if (d.cat !== dest && (d.cat.shared || dest.shared)) return [copyTask(d.task)];
  const i = d.cat.tasks.indexOf(d.task);
  return d.cat.tasks.splice(i, blockEnd(d.cat.tasks, i) - i);
}

function addTask(cat, text, due, rec) {
  insertTask(cat, { done: false, text, due: due || undefined, rec: rec || undefined, created: stampNow() });
  collapsed.delete(cat.name);
  return saveTodos();
}
function setDone(cat, task, done) {
  const i = cat.tasks.indexOf(task);
  const parent = parentOf(cat.tasks, i);
  const block = cat.tasks.splice(i, blockEnd(cat.tasks, i) - i);
  const now = stampNow();
  // Üst görev tamamlanınca alt görevleri de tamamlanır (Todoist gibi); geri alınınca yalnızca kendisi açılır
  for (const t of done ? block : [task]) {
    if (!!t.done === done) continue;
    t.done = done;
    if (done) t.completed = now; else delete t.completed;
  }
  // Tekrarlayan görev tamamlanınca bir sonraki tarihle yeni bir kopyası (alt görevleri açık olarak) oluşur;
  // tamamlanan kopya tekrar bilgisini bırakır (geri alınıp yeniden işaretlenirse çift oluşmasın)
  if (done && task.rec) {
    const copy = block.map(t => ({ done: false, text: t.text, ...(t.level ? { level: t.level } : {}), created: now }));
    const rel = (task.remind || []).filter(isRelRemind);   // sabit tarihli hatırlatıcılar tekrara geçmez
    Object.assign(copy[0], { rec: task.rec, due: nextRecDate(task.rec, task.due), ...(task.time ? { time: task.time } : {}), ...(rel.length ? { remind: rel } : {}) });
    delete task.rec;
    reinsert(cat, copy, parent);
  }
  reinsert(cat, block, parent);
  return saveTodos();
}
function setDue(task, iso) {
  task.due = iso || undefined;
  return saveTodos();
}
function setDueRec(task, { due, rec, time, remind }) {
  task.due = due || undefined;
  task.rec = rec || undefined;
  task.time = due && time ? time : undefined;
  task.remind = remind?.length ? remind : undefined;
  return saveTodos();
}
const allTasks = () => activeCats().flatMap(cat => cat.tasks.map(task => ({ cat, task })));

// --- Pasif yapma / geri getirme ---
function deleteTask(cat, task) {
  const i = cat.tasks.indexOf(task);
  const gone = cat.tasks.splice(i, blockEnd(cat.tasks, i) - i);   // alt görevler de birlikte pasif olur
  if (!cat.shared) cat.hidden.push(...gone.map(t => `${taskLine(t)} ${deletedMark()}`));   // ortak görev bulutta yumuşak silinir (pushShared)
}
function deleteCategory(cat) {
  cat.deleted = true;
  cat.mark = deletedMark();
  if (!activeCats().length) todo.cats.push(newCat(GENERAL));
}
function restoreHiddenTask(cat, index) {
  const [line] = cat.hidden.splice(index, 1);
  const task = parseTaskLine(line.replace(DEL_RE, ''));
  if (task) insertTask(cat, task);
}
function restoreCategory(cat) {
  const same = activeCats().find(c => !c.shared && c.name === cat.name);
  if (same) {
    // Aynı adda aktif bir kategori varsa görevler ona katılır
    same.tasks = sortTree([...same.tasks, ...cat.tasks]);
    same.hidden.push(...cat.hidden);
    todo.cats.splice(todo.cats.indexOf(cat), 1);
  } else {
    cat.deleted = false;
    delete cat.mark;
    cat.tasks = sortTree(cat.tasks);
  }
}

// Görev bilgisi ipucu: eklenme / tamamlanma zamanı
function taskTitle(task) {
  const parts = [];
  if (task.created) parts.push(`Eklendi: ${fmtStampStr(task.created)}`);
  if (task.done && task.completed) parts.push(`Tamamlandı: ${fmtStampStr(task.completed)}`);
  parts.push('Düzenlemek için tıkla');
  return parts.join('\n');
}
function dueButtonHtml(task) {
  const rec = task.rec ? `<span class="rec" title="${esc(recLabel(task.rec))}">↻</span>` : '';
  const bell = task.remind?.length ? `<span class="bell" title="${esc('Hatırlat: ' + task.remind.map(remindLabel).join(', '))}">🔔</span>` : '';
  if (!task.due) return `<button class="due ${task.rec || bell ? 'future' : 'none'}" title="Son tarih ekle">${rec}${bell || (rec ? '' : '📅')}</button>`;
  const d = dueInfo(task.due, task.done);
  const recTip = task.rec ? `\nTekrar: ${recLabel(task.rec)}` : '';
  const timeTip = task.time ? `\nSaat: ${task.time}` : '';
  return `<button class="due ${d.cls}" title="${d.title}${timeTip}${recTip}\n(değiştirmek için tıkla)">${rec}${d.label}${task.time ? ' ' + task.time : ''}${bell}</button>`;
}

const folded = new WeakSet();   // alt görevleri gizlenmiş görevler (yalnızca bu oturumda)
// Çizilecek görevler: tamamlananlar gizliyse açık alt görevi olan yapılmış görev yine görünür; daraltılmış görevin alt görevleri gizlenir
function visibleTasks(cat) {
  const out = [];
  let hideBelow = -1;
  cat.tasks.forEach((t, i) => {
    if (hideBelow >= 0 && lvl(t) > hideBelow) return;
    hideBelow = folded.has(t) ? lvl(t) : -1;
    const open = !t.done || cat.tasks.slice(i + 1, blockEnd(cat.tasks, i)).some(x => !x.done);
    if ((showDone || open) && (!mineOnly || isMine(t))) out.push(t);
  });
  return out;
}

function renderTodos() {
  const root = $('#todoList');
  root.innerHTML = '';
  let open = 0;

  for (const cat of activeCats()) {
    // "Bana atananlar" süzgeci: yalnızca bana atanmış görevi olan ortak kategoriler
    if (mineOnly && !cat.tasks.some(t => isMine(t) && (showDone || !t.done))) continue;
    const openCount = openCountOf(cat);
    const doneCount = cat.tasks.length - openCount;
    open += openCount;

    const sec = document.createElement('section');
    sec.className = 'cat' + (collapsed.has(cat.name) ? ' collapsed' : '');
    sec.style.setProperty('--c', catColor(cat));
    sec.innerHTML = `
      <div class="cat-head" draggable="true" title="Sürükleyerek sırala">
        <span class="chev">▼</span>
        <span class="dot" title="${loadTitle(cat)}"></span>
        <span class="name">${esc(cat.name)}</span>${cat.shared ? `<button class="shared-mark" title="${esc(sharedTitle(cat))}">👥 ${cat.uyeler.length}</button>` : ''}
        <span class="cnt" title="Yapılmamış / toplam">${openCount}${cat.tasks.length ? ' / ' + cat.tasks.length : ''}</span>
        <span class="tools">
          <button class="add" title="Bu kategoriye görev ekle">＋</button>
          ${cat.shared && !isOwner(cat) ? '' : '<button class="ren" title="Yeniden adlandır">✎</button>'}
          ${cat.shared && !isOwner(cat) ? '' : '<button class="del" title="Kategoriyi sil">🗑</button>'}
        </span>
      </div>
      <ul></ul>`;
    const head = sec.querySelector('.cat-head');
    head.onclick = e => {
      if (e.target.closest('button, input')) return;
      collapsed.has(cat.name) ? collapsed.delete(cat.name) : collapsed.add(cat.name);
      store.set('collapsedCats', [...collapsed]);
      sec.classList.toggle('collapsed');
    };
    head.querySelector('.add').onclick = () => startNewTask(cat);
    const memBtn = head.querySelector('.shared-mark');
    if (memBtn) memBtn.onclick = () => openMembers(cat);
    const renBtn = head.querySelector('.ren'), delBtn = head.querySelector('.del');
    if (renBtn) {
      renBtn.onclick = () => renameCategory(cat, head);
      head.querySelector('.name').ondblclick = () => renameCategory(cat, head);
    }
    if (delBtn) delBtn.onclick = () => {
      if (cat.shared) {
        if (!confirm(`"${cat.name}" ortak kategorisi, içindeki görevlerle birlikte TÜM üyeler için silinsin mi?

Bu işlem geri alınamaz.`)) return;
        deleteSharedCategory(cat);
        return;
      }
      const msg = cat.tasks.length
        ? `"${cat.name}" kategorisi ve içindeki ${cat.tasks.length} görev silinsin mi?\n\n(Silinenler penceresinden ya da todo.md dosyasından geri getirebilirsin.)`
        : `"${cat.name}" kategorisi silinsin mi?`;
      if (!confirm(msg)) return;
      deleteCategory(cat);
      saveTodos();
    };

    // --- Kategori sürükleme (başlıktan tutup) ---
    head.addEventListener('dragstart', e => {
      if (e.target !== head) return;
      dragging = { type: 'cat', cat };
      e.dataTransfer.effectAllowed = 'move';
      sec.classList.add('dragging');
    });
    head.addEventListener('dragend', endDrag);

    // --- Bırakma hedefi olarak kategori ---
    sec.addEventListener('dragover', e => {
      if (!dragging || (dragging.type !== 'cat' && dragging.type !== 'task')) return;
      e.preventDefault();
      clearDropMarks();
      if (dragging.type === 'cat') { if (dragging.cat !== cat) sec.classList.add(upperHalf(e, sec) ? 'drop-before' : 'drop-after'); }
      else head.classList.add('drop-after'); // görevi kategorinin başına bırak
    });
    sec.addEventListener('drop', e => {
      e.preventDefault();
      const d = dragging;
      if (!d) return;
      if (d.type === 'cat' && d.cat !== cat) {
        const before = upperHalf(e, sec);
        todo.cats.splice(todo.cats.indexOf(d.cat), 1);
        todo.cats.splice(todo.cats.indexOf(cat) + (before ? 0 : 1), 0, d.cat);
      } else if (d.type === 'task') {
        if (d.cat === cat && cat.shared) return endDrag();   // ortak kategoride sıra oluşturma tarihine göre
        const block = takeBlock(d, cat);
        setBlockLevel(block, 0);
        reinsert(cat, block, null);
        collapsed.delete(cat.name);
      } else return;
      endDrag();
      saveTodos();
    });

    const ul = sec.querySelector('ul');
    const tasks = visibleTasks(cat);
    // Kategorideki "+" ile açılan boş görev satırı en üstte durur
    const newHere = pendingNew && pendingNew.cat === cat;
    if (newHere && !pendingNew.after) ul.append(buildNewTaskRow());
    // Görevdeki "+" / alt görev "+" ile açılan satır, eklenecek konumdan önceki son görünür görevin altında durur
    const newAnchor = newHere && pendingNew.after ? tasks.filter(t => cat.tasks.indexOf(t) < newTaskIndex(pendingNew)).pop() : null;
    for (const task of tasks) {
      const ti = cat.tasks.indexOf(task), subs = cat.tasks.slice(ti + 1, blockEnd(cat.tasks, ti));
      const li = document.createElement('li');
      li.className = (task.done ? 'done' : '') + (lvl(task) ? ' sub' : '');
      li.style.setProperty('--lvl', lvl(task));
      li.draggable = true;
      li.innerHTML = (subs.length ? `<button class="fold" title="Alt görevleri göster/gizle">${folded.has(task) ? '▸' : '▾'}</button>` : '')
        + `<input type="checkbox" ${task.done ? 'checked' : ''}>`
        + `<span class="txt" title="${esc(taskTitle(task))}">${renderInline(task.text)}</span>`
        + (subs.length ? `<span class="sub-cnt" title="Tamamlanan alt görev">${subs.filter(t => t.done).length}/${subs.length}</span>` : '')
        + (cat.shared ? assigneeButtonHtml(cat, task) : '')
        + dueButtonHtml(task)
        + (cat.shared ? '' : '<button class="row-add" title="Altına görev ekle">＋</button>')
        + (cat.shared || lvl(task) >= MAX_LEVEL ? '' : '<button class="row-add sub-add" title="Alt görev ekle">⤷</button>')
        + '<button class="del" title="Sil">✕</button>';
      const fold = li.querySelector('.fold');
      if (fold) fold.onclick = () => { folded.has(task) ? folded.delete(task) : folded.add(task); renderTodos(); };
      li.querySelector('input').onchange = e => setDone(cat, task, e.target.checked);
      const asg = li.querySelector('.asg');
      if (asg) asg.onclick = e => pickAssignee(e.currentTarget, cat, task);
      const rowAdd = li.querySelector('.row-add:not(.sub-add)'), subAdd = li.querySelector('.sub-add');
      if (rowAdd) rowAdd.onclick = () => startNewTask(cat, task, lvl(task));
      if (subAdd) subAdd.onclick = () => { folded.delete(task); startNewTask(cat, task, lvl(task) + 1); };
      li.querySelector('.del').onclick = () => {
        if (subs.length && !confirm(`Bu görevle birlikte ${subs.length} alt görev de silinsin mi?

(Silinenler penceresinden geri getirebilirsin.)`)) return;
        deleteTask(cat, task);
        saveTodos();
      };
      li.querySelector('.due').onclick = e => pickDate(e.currentTarget, { due: task.due, rec: task.rec, time: task.time, remind: task.remind, allowTime: !cat.shared }, v => setDueRec(task, v));
      // Metne tıklayınca düzenleme modu (metindeki bağlantıya tıklamak bağlantıyı açar)
      li.querySelector('.txt').onclick = e => { if (!e.target.closest('a')) editTask(li, task, cat); };

      // --- Görev sürükleme: aynı kategoride sırala ya da başka kategoriye taşı ---
      li.addEventListener('dragstart', e => {
        e.stopPropagation();
        dragging = { type: 'task', cat, task };
        e.dataTransfer.effectAllowed = 'move';
        li.classList.add('dragging');
      });
      li.addEventListener('dragend', endDrag);
      li.addEventListener('dragover', e => {
        if (dragging?.type !== 'task') return;
        e.preventDefault();
        e.stopPropagation();
        clearDropMarks();
        if (dragging.task !== task) li.classList.add(upperHalf(e, li) ? 'drop-before' : 'drop-after');
      });
      li.addEventListener('drop', e => {
        if (dragging?.type !== 'task') return;
        e.preventDefault();
        e.stopPropagation();
        const d = dragging;
        if (d.task === task) return endDrag();
        if (d.cat === cat && cat.shared) return endDrag();   // ortak kategoride sıra oluşturma tarihine göre
        if (d.cat === cat && blockOf(cat, d.task).includes(task)) return endDrag();   // görev kendi alt görevinin yanına bırakılamaz
        const before = upperHalf(e, li);
        const block = takeBlock(d, cat);
        setBlockLevel(block, lvl(task));   // hedef görevle aynı seviyeye (kardeş) gelir
        const ti = cat.tasks.indexOf(task);
        cat.tasks.splice(before ? ti : blockEnd(cat.tasks, ti), 0, ...block);
        // Yapılmış/yapılmamış ayrımı her zaman korunur
        cat.tasks = sortTree(cat.tasks);
        endDrag();
        saveTodos();
      });
      ul.append(li);
      if (newAnchor === task) ul.append(buildNewTaskRow());
    }
    if (!tasks.length && !(newHere && !pendingNew.after)) {
      const li = document.createElement('li');
      li.className = 'none';
      li.textContent = doneCount ? `${doneCount} tamamlanmış görev gizli` : 'Görev yok';
      ul.append(li);
    }
    root.append(sec);
  }

  $('#todoCount').textContent = open ? String(open) : '';
  $('#filterMine').hidden = !sharedCats().length;
  $('#filterMine').classList.toggle('on', mineOnly);
  if (mineOnly && !root.children.length) root.innerHTML = '<p class="muted" style="padding:8px 4px">Sana atanmış görev yok.</p>';
  $('#toggleDone').textContent = showDone ? 'Tamamlananları gizle' : 'Tamamlananları göster';
  // Bekleyen satır artık çizilemiyorsa (görev/kategori silindi ya da gizlendi) vazgeç
  const newRow = $('#todoList .new-task');
  if (pendingNew && !newRow) pendingNew = null;
  if (newRow && pendingFocus) {
    pendingFocus = false;
    const input = newRow.querySelector('.task-input');
    input.focus();
    newRow.scrollIntoView({ block: 'nearest' });
  }
  renderCalendar();
  renderStats();
}

// Bloğu bir seviye girintile (önceki kardeşin son alt görevi olur) ya da bir seviye çıkar (üstünün hemen altına geçer). Değişirse true.
function indentTask(cat, task, delta) {
  const t = cat.tasks, i = t.indexOf(task), L = lvl(task);
  const block = t.slice(i, blockEnd(t, i));
  if (delta > 0) {
    const prev = t[i - 1];
    if (!prev || lvl(prev) < L || Math.max(...block.map(lvl)) >= MAX_LEVEL) return false;   // önceki bir kardeş olmalı, en fazla 3 seviye
    setBlockLevel(block, L + 1);
  } else {
    if (!L) return false;
    const parent = parentOf(t, i);
    t.splice(i, block.length);
    setBlockLevel(block, L - 1);
    t.splice(blockEnd(t, t.indexOf(parent)), 0, ...block);   // sonraki kardeşler üstte kalır, bu görev üstünün altına geçer
  }
  cat.tasks = sortTree(t);
  return true;
}

// Görev metnini yerinde düzenle: Enter / odaktan çıkma kaydeder, Esc vazgeçer.
// Ham Markdown düzenlenir (ör. **kalın**). Metne "📅 2026-10-10" yazılırsa son tarih olarak alınır.
function editTask(li, task, cat) {
  if (li.classList.contains('editing')) return;
  li.classList.add('editing');
  li.draggable = false;
  const txt = li.querySelector('.txt');
  const input = document.createElement('input');
  input.className = 'task-input';
  input.value = task.text;
  txt.replaceWith(input);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  let done = false;
  const finish = (ok, indent = 0) => {
    if (done) return;
    done = true;
    // Hem "📅 2026-10-10" biçimi hem de "yarın / cuma / her hafta" gibi ifadeler tanınır
    const parsed = parseTaskBody(input.value.trim().replace(/\s*\n\s*/g, ' '));
    // Metin değişmediyse doğal dil çözümlemesi yapma (ör. "Pazar alışverişi" kendiliğinden tarihlenmesin)
    const nl = parsed.text !== task.text ? parseNatural(parsed.text) : { text: parsed.text };
    const text = nl.text || parsed.text;
    const due = parsed.due || nl.due, rec = parsed.rec || nl.rec, time = parsed.time || nl.time;
    const changed = ok && text && (text !== task.text || due || rec || time);
    if (changed) {
      task.text = text;
      if (due) task.due = due;
      if (rec) task.rec = rec;
      if (time && !cat.shared) { task.time = time; if (!task.due) task.due = todayISO(); }
      if (parsed.remind && !cat.shared) task.remind = [...new Set([...(task.remind || []), ...parsed.remind])];
    }
    // Tab / Shift+Tab: görevi bir önceki görevin alt görevi yap / bir seviye çıkar
    const moved = ok && indent && !cat.shared && indentTask(cat, task, indent);
    if (changed || moved) saveTodos(); else renderTodos();
  };
  input.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    if (e.key === 'Tab') { e.preventDefault(); finish(true, e.shiftKey ? -1 : 1); }
  };
  input.onblur = () => finish(true);
}

// ============ Satır içi yeni görev ============
// Kategorideki "+" → kategorinin en üstünde, görevdeki "+" → o görevin hemen altında boş bir satır açılır.
// Enter: ekle ve altına bir sonraki boş satırı aç (art arda hızlı giriş) · Esc ya da boş bırakıp çıkmak: vazgeç.
// Yeni görev varsayılan olarak bugünün tarihini alır; satırdaki tarih düğmesinden değiştirilebilir,
// metne "yarın", "cuma", "15 ekim", "her hafta" gibi yazılırsa o algılanır.
// level: eklenecek görevin seviyesi (görevin "+"ı kardeş, "⤷"ı alt görev ekler); Tab / Shift+Tab ile satırda değişir
function startNewTask(cat, after = null, level = 0) {
  if (collapsed.delete(cat.name)) store.set('collapsedCats', [...collapsed]);
  selectCat(cat.name);
  pendingNew = { cat, after, level: after ? level : 0, due: todayISO(), rec: null, time: null, remind: [], text: '', manual: false };
  pendingFocus = true;
  renderTodos();
}

// Bekleyen yeni görevin listedeki yeri: after görevinin (ya da p.level seviyesindeki üstünün) bloğundan hemen sonra
function newTaskIndex(p) {
  const t = p.cat.tasks, ai = t.indexOf(p.after);
  if (ai === -1) return 0;
  if (p.level > lvl(p.after)) return blockEnd(t, ai);
  for (let j = ai; j >= 0; j--) if (lvl(t[j]) === p.level) return blockEnd(t, j);
  return blockEnd(t, ai);
}

function buildNewTaskRow() {
  const p = pendingNew;
  const li = document.createElement('li');
  li.className = 'new-task';
  li.style.setProperty('--lvl', p.level);
  li.innerHTML = '<input type="checkbox" disabled>'
    + '<input class="task-input" placeholder="Yeni görev…  (Enter: ekle · Esc: vazgeç)" autocomplete="off">'
    + '<button type="button" class="due-btn"></button>';
  const input = li.querySelector('.task-input'), dueBtn = li.querySelector('.due-btn');
  input.value = p.text;

  // Tarih düğmesi: yazılan metinden algılanan tarih/tekrar varsa onu, yoksa seçileni gösterir
  const effective = () => {
    const nl = p.manual ? {} : parseNatural(input.value);
    const time = (p.cat.shared ? null : nl.time) || p.time;
    return { due: nl.due || (time && !p.due ? todayISO() : p.due), rec: nl.rec || p.rec, time, fromText: !!(nl.due || nl.rec || nl.time) };
  };
  const renderDue = () => {
    const e = effective(), rec = e.rec ? '↻ ' : '', bell = p.remind.length ? ' 🔔' : '';
    if (e.due) { const d = dueInfo(e.due, false); dueBtn.textContent = `📅 ${rec}${d.label}${e.time ? ' ' + e.time : ''}${bell}`; dueBtn.className = `due-btn ${d.cls}`; }
    else { dueBtn.textContent = `📅 ${rec}Tarihsiz`; dueBtn.className = 'due-btn none'; }
    dueBtn.classList.toggle('nl', e.fromText);
    dueBtn.title = e.fromText ? 'Yazdığın metinden algılandı' : 'Son tarih (değiştirmek için tıkla)';
  };
  renderDue();
  input.addEventListener('input', () => { p.text = input.value; renderDue(); });
  dueBtn.onclick = () => pickDate(dueBtn, { due: effective().due, rec: effective().rec, time: effective().time, remind: p.remind, allowTime: !p.cat.shared }, v => {
    p.due = v.due; p.rec = v.rec; p.time = v.time; p.remind = v.remind; p.manual = true; renderDue(); input.focus();
  }, () => input.focus());

  let finished = false;
  const cancel = () => { if (finished) return; finished = true; pendingNew = null; renderTodos(); };
  const commit = chain => {
    if (finished) return;
    const parsed = parseTaskBody(input.value.trim().replace(/\s*\n\s*/g, ' '));
    const nl = p.manual ? { text: parsed.text } : parseNatural(parsed.text);
    const text = nl.text || parsed.text;
    if (!text) return cancel();
    finished = true;
    const due = parsed.due || nl.due || p.due, rec = parsed.rec || nl.rec || p.rec;
    const time = !p.cat.shared && due ? (parsed.time || nl.time || p.time) : null;
    const remind = !p.cat.shared ? [...new Set([...(parsed.remind || []), ...p.remind])] : [];
    const task = { done: false, text, due: due || undefined, rec: rec || undefined, ...(time ? { time } : {}), ...(remind.length ? { remind } : {}), created: stampNow() };
    if (p.level) task.level = p.level;
    if (!p.after || p.cat.tasks.indexOf(p.after) === -1) insertTask(p.cat, task);
    else { p.cat.tasks.splice(newTaskIndex(p), 0, task); p.cat.tasks = sortTree(p.cat.tasks); }
    pendingNew = chain ? { cat: p.cat, after: p.cat.shared ? null : task, level: p.cat.shared ? 0 : p.level, due: todayISO(), rec: null, time: null, remind: [], text: '', manual: false } : null;
    pendingFocus = chain;
    saveTodos();
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(true); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    if (e.key === 'Tab') {   // satırın seviyesini değiştir: Tab → alt görev, Shift+Tab → bir seviye çıkar
      e.preventDefault();
      const max = p.after ? Math.min(MAX_LEVEL, lvl(p.after) + 1) : 0;
      const next = Math.max(0, Math.min(max, p.level + (e.shiftKey ? -1 : 1)));
      if (next === p.level) return;
      finished = true;   // satır yeniden çizilecek; eski satırın odak kaybı görev eklemesin
      p.level = next;
      p.text = input.value;
      pendingFocus = true;
      renderTodos();
    }
  });
  // Odak başka yere gidince: yazı varsa ekle, boşsa vazgeç. Tarih penceresine geçiş ya da pencerenin
  // (başka uygulamaya geçerek) odağı kaybetmesi satırı kapatmaz.
  input.addEventListener('blur', () => setTimeout(() => {
    if (finished || pendingNew !== p || !document.hasFocus()) return;
    const ae = document.activeElement;
    if (li.contains(ae) || ae?.closest?.('#datePop')) return;
    commit(false);
  }, 0));
  return li;
}

// Varsayılan kategori: en son "+" ile kullanılan (takvimden görev eklerken de bu önerilir)
function currentCat() {
  const cats = activeCats();
  return cats.find(c => c.name === selectedCat) || cats[0];
}
function selectCat(name) {
  selectedCat = name;
  store.set('lastCatName', name);
}

function renameCategory(cat, head) {
  const nameEl = head.querySelector('.name');
  const input = document.createElement('input');
  input.className = 'cat-input';
  input.value = cat.name;
  head.draggable = false;
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = ok => {
    if (done) return;
    done = true;
    const v = cleanCatName(input.value);
    if (ok && v && v !== cat.name && !activeCats().some(c => c.name === v)) {
      if (collapsed.delete(cat.name)) { collapsed.add(v); store.set('collapsedCats', [...collapsed]); }
      if (selectedCat === cat.name) selectCat(v);
      cat.name = v;
      if (cat.shared) renameSharedCategory(cat, v);
      saveTodos();
    } else renderTodos();
  };
  input.onkeydown = e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); };
  input.onblur = () => finish(true);
}
const cleanCatName = s => s.replace(/[\r\n]+/g, ' ').replace(/^#+\s*/, '').trim().slice(0, 60);

$('#addCat').onclick = () => addCategory(false);
$('#addSharedCat').onclick = () => addCategory(true);
function addCategory(shared) {
  const root = $('#todoList');
  const sec = document.createElement('section');
  sec.className = 'cat';
  sec.innerHTML = `<div class="cat-head"><span class="chev">▼</span><input class="cat-input" placeholder="${shared ? 'Ortak kategori adı…' : 'Kategori adı…'} (Enter)"></div>`;
  root.append(sec);
  const input = sec.querySelector('input');
  input.focus();
  sec.scrollIntoView({ block: 'nearest' });
  let done = false;
  const finish = ok => {
    if (done) return;
    done = true;
    const v = cleanCatName(input.value);
    if (ok && v && shared) {
      createSharedCategory(v);   // kategori buluttan dinleyiciyle gelince listede görünür
      sec.remove();
    } else if (ok && v) {
      if (!activeCats().some(c => c.name === v)) todo.cats.push(newCat(v));
      const created = activeCats().find(c => c.name === v);
      saveTodos().then(() => startNewTask(created));
    } else sec.remove();
  };
  input.onkeydown = e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); };
  input.onblur = () => finish(true);
}

$('#filterMine').onclick = () => { mineOnly = !mineOnly; store.set('mineOnly', mineOnly); renderTodos(); };
$('#toggleDone').onclick = () => { showDone = !showDone; store.set('showDone', showDone); renderTodos(); };
