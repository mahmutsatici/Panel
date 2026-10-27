// ============ Yapılacaklar (todo.md) ============
// Dosya biçimi:
//   # Yapılacaklar
//   ## İş
//   - [ ] rapor yaz 📅 2026-10-10 <!-- eklendi:2026-10-05T15:40 -->
//   - [x] toplantı 📅 2026-10-04 <!-- eklendi:2026-10-01T09:00 tamamlandı:2026-10-04T11:30 -->
//   ## Ev
//   ...
// · Dosyadaki sıra = ekrandaki sıra (yapılmamışlar üstte, yapılmışlar altta). Sürükle-bırak ile değişir.
// · "📅 YYYY-AA-GG" son tarihtir (Obsidian Tasks ile aynı biçim).
// · <!-- eklendi:… tamamlandı:… --> arka planda tutulan zaman bilgisidir; Markdown'da görünmez.
// · Silme = pasif yapma. Satır kalır, sonuna <!-- silindi: … --> eklenir; bu işaret silinince geri gelir.
//   Kategori silinirse başlığına eklenir: ## Eski kategori <!-- silindi: … -->
const TASK_RE = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;
const DEL_RE = /\s*<!--\s*silindi\b[^>]*-->\s*$/i;
const DEL_AT_RE = /<!--\s*silindi:?\s*([^>]*?)\s*-->/i;
const META_RE = /\s*<!--\s*((?:eklendi|tamamlandı):[^>]*?)\s*-->/u;
const DUE_RE = /\s*📅\s*(\d{4}-\d{2}-\d{2})/u;
const REC_RE = /\s*🔁\s*([^📅<]*?)\s*(?=📅|<!--|$)/u;
const deletedMark = () => `<!-- silindi: ${new Date().toLocaleString('sv-SE').slice(0, 16)} -->`;
const GENERAL = 'Genel';
const newCat = name => ({ name, tasks: [], hidden: [] });
const activeCats = () => todo.cats.filter(c => !c.deleted);
let todo = { head: '# Yapılacaklar', cats: [] };
let showDone = store.get('showDone', true);
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
  const rec = body.match(REC_RE);
  if (rec && normalizeRec(rec[1])) { task.rec = normalizeRec(rec[1]); body = body.replace(REC_RE, ''); }
  task.text = body.trim();
  return task;
}
function parseTaskLine(line) {
  const t = line.match(TASK_RE);
  return t ? { done: t[1] !== ' ', ...parseTaskBody(t[2]) } : null;
}
function taskLine(t) {
  let s = `- [${t.done ? 'x' : ' '}] ${t.text}`;
  if (t.rec) s += ` 🔁 ${t.rec}`;
  if (t.due) s += ` 📅 ${t.due}`;
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
  for (const c of cats) if (!c.deleted) c.tasks = partition(c.tasks);
  return { head: head || '# Yapılacaklar', cats };
}

function serializeTodos() {
  const out = [todo.head, ''];
  for (const c of todo.cats) {
    if (c.shared) continue;   // ortak kategoriler buluttadır, todo.md'ye yazılmaz
    out.push(c.deleted ? `## ${c.name} ${c.mark}` : `## ${c.name}`);
    for (const t of c.tasks) out.push(taskLine(t));
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

function insertTask(cat, task) {
  // Yapılmamış → en üste; yapılmış → yapılmışların en üstüne.
  if (!task.done) cat.tasks.unshift(task);
  else {
    const i = cat.tasks.findIndex(t => t.done);
    cat.tasks.splice(i === -1 ? cat.tasks.length : i, 0, task);
  }
}
const removeTask = (cat, task) => cat.tasks.splice(cat.tasks.indexOf(task), 1);
// Sürüklenen görev: aynı kategoride ya da iki yerel kategori arasında taşınır; ortak kategoriyle yerel arasında kopyalanır
function moveOrCopy(d, dest) {
  if (d.cat !== dest && (d.cat.shared || dest.shared)) return copyTask(d.task);
  removeTask(d.cat, d.task);
  return d.task;
}

function addTask(cat, text, due, rec) {
  insertTask(cat, { done: false, text, due: due || undefined, rec: rec || undefined, created: stampNow() });
  collapsed.delete(cat.name);
  return saveTodos();
}
function setDone(cat, task, done) {
  removeTask(cat, task);
  task.done = done;
  if (done) task.completed = stampNow(); else delete task.completed;
  // Tekrarlayan görev tamamlanınca bir sonraki tarihle yeni bir kopyası oluşur;
  // tamamlanan kopya tekrar bilgisini bırakır (geri alınıp yeniden işaretlenirse çift oluşmasın)
  if (done && task.rec) {
    insertTask(cat, { done: false, text: task.text, rec: task.rec, due: nextRecDate(task.rec, task.due), created: stampNow() });
    delete task.rec;
  }
  insertTask(cat, task);
  return saveTodos();
}
function setDue(task, iso) {
  task.due = iso || undefined;
  return saveTodos();
}
function setDueRec(task, { due, rec }) {
  task.due = due || undefined;
  task.rec = rec || undefined;
  return saveTodos();
}
const allTasks = () => activeCats().flatMap(cat => cat.tasks.map(task => ({ cat, task })));

// --- Pasif yapma / geri getirme ---
function deleteTask(cat, task) {
  removeTask(cat, task);
  if (!cat.shared) cat.hidden.push(`${taskLine(task)} ${deletedMark()}`);   // ortak görev bulutta yumuşak silinir (pushShared)
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
    same.tasks = partition([...same.tasks, ...cat.tasks]);
    same.hidden.push(...cat.hidden);
    todo.cats.splice(todo.cats.indexOf(cat), 1);
  } else {
    cat.deleted = false;
    delete cat.mark;
    cat.tasks = partition(cat.tasks);
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
  if (!task.due) return `<button class="due ${task.rec ? 'future' : 'none'}" title="Son tarih ekle">${rec || '📅'}</button>`;
  const d = dueInfo(task.due, task.done);
  const recTip = task.rec ? `\nTekrar: ${recLabel(task.rec)}` : '';
  return `<button class="due ${d.cls}" title="${d.title}${recTip}\n(değiştirmek için tıkla)">${rec}${d.label}</button>`;
}

function renderTodos() {
  const root = $('#todoList');
  root.innerHTML = '';
  let open = 0;

  for (const cat of activeCats()) {
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
        <span class="name">${esc(cat.name)}</span>${cat.shared ? `<span class="shared-mark" title="${esc(sharedTitle(cat))}">👥</span>` : ''}
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
        insertTask(cat, moveOrCopy(d, cat));
        collapsed.delete(cat.name);
      } else return;
      endDrag();
      saveTodos();
    });

    const ul = sec.querySelector('ul');
    const tasks = cat.tasks.filter(t => showDone || !t.done);
    // Kategorideki "+" ile açılan boş görev satırı en üstte durur
    const newHere = pendingNew && pendingNew.cat === cat;
    if (newHere && !pendingNew.after) ul.append(buildNewTaskRow());
    for (const task of tasks) {
      const li = document.createElement('li');
      li.className = task.done ? 'done' : '';
      li.draggable = true;
      li.innerHTML = `<input type="checkbox" ${task.done ? 'checked' : ''}>`
        + `<span class="txt" title="${esc(taskTitle(task))}">${renderInline(task.text)}</span>`
        + dueButtonHtml(task)
        + (cat.shared ? '' : '<button class="row-add" title="Altına görev ekle">＋</button>')
        + '<button class="del" title="Sil">✕</button>';
      li.querySelector('input').onchange = e => setDone(cat, task, e.target.checked);
      const rowAdd = li.querySelector('.row-add');
      if (rowAdd) rowAdd.onclick = () => startNewTask(cat, task);
      li.querySelector('.del').onclick = () => { deleteTask(cat, task); saveTodos(); };
      li.querySelector('.due').onclick = e => pickDate(e.currentTarget, { due: task.due, rec: task.rec }, v => setDueRec(task, v));
      // Metne tıklayınca düzenleme modu (metindeki bağlantıya tıklamak bağlantıyı açar)
      li.querySelector('.txt').onclick = e => { if (!e.target.closest('a')) editTask(li, task); };

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
        const before = upperHalf(e, li);
        const moved = moveOrCopy(d, cat);
        cat.tasks.splice(cat.tasks.indexOf(task) + (before ? 0 : 1), 0, moved);
        // Yapılmış/yapılmamış ayrımı her zaman korunur
        cat.tasks = partition(cat.tasks);
        endDrag();
        saveTodos();
      });
      ul.append(li);
      // Görevdeki "+" ile açılan boş satır, o görevin hemen altında durur
      if (newHere && pendingNew.after === task) ul.append(buildNewTaskRow());
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

// Görev metnini yerinde düzenle: Enter / odaktan çıkma kaydeder, Esc vazgeçer.
// Ham Markdown düzenlenir (ör. **kalın**). Metne "📅 2026-10-10" yazılırsa son tarih olarak alınır.
function editTask(li, task) {
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
  const finish = ok => {
    if (done) return;
    done = true;
    // Hem "📅 2026-10-10" biçimi hem de "yarın / cuma / her hafta" gibi ifadeler tanınır
    const parsed = parseTaskBody(input.value.trim().replace(/\s*\n\s*/g, ' '));
    // Metin değişmediyse doğal dil çözümlemesi yapma (ör. "Pazar alışverişi" kendiliğinden tarihlenmesin)
    const nl = parsed.text !== task.text ? parseNatural(parsed.text) : { text: parsed.text };
    const text = nl.text || parsed.text;
    const due = parsed.due || nl.due, rec = parsed.rec || nl.rec;
    if (ok && text && (text !== task.text || due || rec)) {
      task.text = text;
      if (due) task.due = due;
      if (rec) task.rec = rec;
      saveTodos();
    } else renderTodos();
  };
  input.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  input.onblur = () => finish(true);
}

// ============ Satır içi yeni görev ============
// Kategorideki "+" → kategorinin en üstünde, görevdeki "+" → o görevin hemen altında boş bir satır açılır.
// Enter: ekle ve altına bir sonraki boş satırı aç (art arda hızlı giriş) · Esc ya da boş bırakıp çıkmak: vazgeç.
// Yeni görev varsayılan olarak bugünün tarihini alır; satırdaki tarih düğmesinden değiştirilebilir,
// metne "yarın", "cuma", "15 ekim", "her hafta" gibi yazılırsa o algılanır.
function startNewTask(cat, after = null) {
  if (collapsed.delete(cat.name)) store.set('collapsedCats', [...collapsed]);
  selectCat(cat.name);
  pendingNew = { cat, after, due: todayISO(), rec: null, text: '', manual: false };
  pendingFocus = true;
  renderTodos();
}

function buildNewTaskRow() {
  const p = pendingNew;
  const li = document.createElement('li');
  li.className = 'new-task';
  li.innerHTML = '<input type="checkbox" disabled>'
    + '<input class="task-input" placeholder="Yeni görev…  (Enter: ekle · Esc: vazgeç)" autocomplete="off">'
    + '<button type="button" class="due-btn"></button>';
  const input = li.querySelector('.task-input'), dueBtn = li.querySelector('.due-btn');
  input.value = p.text;

  // Tarih düğmesi: yazılan metinden algılanan tarih/tekrar varsa onu, yoksa seçileni gösterir
  const effective = () => {
    const nl = p.manual ? {} : parseNatural(input.value);
    return { due: nl.due || p.due, rec: nl.rec || p.rec, fromText: !!(nl.due || nl.rec) };
  };
  const renderDue = () => {
    const e = effective(), rec = e.rec ? '↻ ' : '';
    if (e.due) { const d = dueInfo(e.due, false); dueBtn.textContent = `📅 ${rec}${d.label}`; dueBtn.className = `due-btn ${d.cls}`; }
    else { dueBtn.textContent = `📅 ${rec}Tarihsiz`; dueBtn.className = 'due-btn none'; }
    dueBtn.classList.toggle('nl', e.fromText);
    dueBtn.title = e.fromText ? 'Yazdığın metinden algılandı' : 'Son tarih (değiştirmek için tıkla)';
  };
  renderDue();
  input.addEventListener('input', () => { p.text = input.value; renderDue(); });
  dueBtn.onclick = () => pickDate(dueBtn, { due: effective().due, rec: effective().rec }, v => {
    p.due = v.due; p.rec = v.rec; p.manual = true; renderDue(); input.focus();
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
    const task = { done: false, text, due: due || undefined, rec: rec || undefined, created: stampNow() };
    const idx = p.after ? p.cat.tasks.indexOf(p.after) : -1;
    if (idx === -1) insertTask(p.cat, task);
    else { p.cat.tasks.splice(idx + 1, 0, task); p.cat.tasks = partition(p.cat.tasks); }
    pendingNew = chain ? { cat: p.cat, after: p.cat.shared ? null : task, due: todayISO(), rec: null, text: '', manual: false } : null;
    pendingFocus = chain;
    saveTodos();
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(true); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
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

$('#toggleDone').onclick = () => { showDone = !showDone; store.set('showDone', showDone); renderTodos(); };
