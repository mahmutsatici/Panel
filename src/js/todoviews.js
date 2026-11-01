// ============ Yapılacaklar: görünüm biçimleri (tam ekran) ============
// Tam ekranda iki ayar vardır: görünüm biçimi (Kart / Liste / Pano) ve gruplama (kategori / gün / öncelik / tamamlanma).
// Kategoriye göre gruplama her zaman kategori kartlarının kendi çizimidir (sürükle-bırak, yeniden adlandırma...); biçim yalnızca yerleşimi değiştirir.
// Diğer gruplamalar tüm görevleri düz listede toplayıp gruplar (alt görevler üst görevin adıyla gösterilir).
let todoMode = store.get('todoMode', 'list');    // 'card' | 'list' | 'board'
let todoCols = store.get('todoCols', 'auto');    // pano sütun sayısı: 'auto' | '2' | '3' | '4'
let todoGroup = store.get('todoGroup', 'cat');   // 'cat' | 'day' | 'prio' | 'done'
const soloTodos = () => document.body.classList.contains('solo');
const categoryCards = () => !soloTodos() || todoGroup === 'cat';

function syncTodoToolbar() {
  $('#todoViews').querySelectorAll('[data-m]').forEach(b => b.classList.toggle('on', b.dataset.m === todoMode));
  $('#todoGroup').value = todoGroup;
  $('#todoCols').value = todoCols;
  $('#todoCols').hidden = todoMode !== 'board';
  const list = $('#todoList');
  list.dataset.mode = soloTodos() ? todoMode : '';
  // Pano sütun sayısı: otomatikte grup sayısı kadar (2–4)
  const groups = todoGroup === 'cat' ? activeCats().length : 4;
  list.style.setProperty('--tv-cols', todoCols === 'auto' ? Math.max(2, Math.min(4, groups)) : todoCols);
}
$('#todoViews').addEventListener('click', e => {
  const b = e.target.closest('[data-m]');
  if (!b || b.dataset.m === todoMode) return;
  todoMode = b.dataset.m;
  store.set('todoMode', todoMode);
  renderTodos();
});
$('#todoCols').onchange = e => { todoCols = e.target.value; store.set('todoCols', todoCols); renderTodos(); };
$('#todoGroup').onchange = e => { todoGroup = e.target.value; store.set('todoGroup', todoGroup); renderTodos(); };

// Gruplama tanımları: her görevi bir gruba koyar; gruplar sırayla çizilir
const DAY_GROUPS = [['Gecikenler', 'var(--load-3)'], ['Bugün', 'var(--load-2)'], ['Yarın', 'var(--accent)'], ['Önümüzdeki 7 gün', 'var(--accent)'], ['Daha sonra', 'var(--muted)'], ['Tarihsiz', 'var(--muted)'], ['Tamamlananlar', 'var(--load-0)']];
const PRIO_COLORS = ['var(--muted)', 'var(--accent)', 'var(--load-2)', 'var(--load-3)'];
const DONE_GROUPS = [['Açık', 'var(--accent)'], ['Bugün tamamlanan', 'var(--load-0)'], ['Dün tamamlanan', 'var(--load-0)'], ['Son 7 gün', 'var(--load-0)'], ['Daha önce', 'var(--muted)'], ['Tarihi bilinmeyen', 'var(--muted)']];
function groupOf({ task }) {
  const today = todayISO();
  if (todoGroup === 'day') {
    if (task.done) return 6;
    if (!task.due) return 5;
    const n = dayDiff(task.due);
    return n < 0 ? 0 : n === 0 ? 1 : n === 1 ? 2 : n <= 7 ? 3 : 4;
  }
  if (todoGroup === 'prio') return 3 - (task.priority || 0);   // 0: yüksek … 3: yok
  if (!task.done) return 0;
  if (!task.completed) return 5;
  const n = dayDiff(task.completed.slice(0, 10));
  return n >= 0 ? 1 : n === -1 ? 2 : n >= -7 ? 3 : 4;
}
const textOf = t => String(t || '').replace(/[*_`~]/g, '');
// Grup içi sıra: yapılmamışlar üstte; öncelik, tarih, saat. "Tamamlanmaya göre"de yapılanlar en son tamamlanan üstte
function cmpTasks(a, b) {
  const x = a.task, y = b.task;
  if (todoGroup === 'done' && x.done && y.done) return (y.completed || '').localeCompare(x.completed || '');
  return (x.done - y.done) || ((y.priority || 0) - (x.priority || 0)) || (x.due || '9').localeCompare(y.due || '9')
    || (x.time || '99').localeCompare(y.time || '99') || x.text.localeCompare(y.text, 'tr');
}

// Kategoriye göre olmayan gruplama: tüm görevleri gruplayıp çizer. Yapılmamış görev sayısını döndürür.
function renderGrouped(root) {
  const wantDone = showDone || todoGroup === 'done';
  const items = allTasks().filter(x => (wantDone || !x.task.done) && (!mineOnly || isMine(x.task)));
  const defs = todoGroup === 'day' ? DAY_GROUPS : todoGroup === 'prio' ? [3, 2, 1, 0].map(n => [PRIO_NAMES[n], PRIO_COLORS[n]]) : DONE_GROUPS;
  const buckets = defs.map(() => []);
  for (const x of items) buckets[groupOf(x)].push(x);

  // Hızlı ekleme: seçili kategoriye (en son kullanılan); "yarın 15:30", "her hafta" gibi ifadeler tanınır
  const cat = currentCat();
  const form = document.createElement('form');
  form.className = 'tv-add';
  form.innerHTML = `<input placeholder="Görev ekle… (Enter) — kategori: ${esc(cat.name)}" autocomplete="off">`;
  form.onsubmit = e => {
    e.preventDefault();
    const input = form.querySelector('input');
    const parsed = parseTaskBody(input.value.trim());
    const nl = parseNatural(parsed.text);
    const text = nl.text || parsed.text;
    if (!text) return;
    addTask(cat, text, parsed.due || nl.due, parsed.rec || nl.rec, parsed.time || nl.time, { priority: parsed.priority, remind: parsed.remind });
  };
  root.append(form);

  defs.forEach(([label, color], i) => {
    const rows = buckets[i].sort(cmpTasks);
    const board = soloTodos() && todoMode === 'board';
    if (!rows.length && !board) return;   // panoda boş gruplar da görünür (görevi oraya sürükleyebilmek için)
    const key = `tv:${todoGroup}:${label}`;
    const sec = document.createElement('section');
    sec.className = 'cat' + (collapsed.has(key) ? ' collapsed' : '');
    sec.innerHTML = `<div class="cat-head"><span class="chev">▼</span><span class="dot" style="--c:${color}"></span><span class="name">${esc(label)}</span><span class="cnt">${rows.length}</span></div><ul></ul>`;
    sec.querySelector('.cat-head').onclick = () => {
      collapsed.has(key) ? collapsed.delete(key) : collapsed.add(key);
      store.set('collapsedCats', [...collapsed]);
      sec.classList.toggle('collapsed');
    };
    const ul = sec.querySelector('ul');
    if (!rows.length) ul.innerHTML = '<li class="none">Buraya sürükle</li>';
    for (const { cat: c, task } of rows) {
      const parent = lvl(task) ? parentOf(c.tasks, c.tasks.indexOf(task)) : null;
      ul.append(buildTaskRow(c, task, { drag: board ? 'source' : false, showCat: true, flat: true, crumb: parent ? textOf(parent.text) : '' }));
    }
    // Panoda görevi başka sütuna sürüklemek onu o gruba taşır (gün / öncelik / tamamlanma değişir)
    if (board) {
      sec.addEventListener('dragover', e => { if (dragging?.type === 'task' && canDropInGroup(i)) { e.preventDefault(); sec.classList.add('drop'); } });
      sec.addEventListener('dragleave', e => { if (!sec.contains(e.relatedTarget)) sec.classList.remove('drop'); });
      sec.addEventListener('drop', e => {
        if (dragging?.type !== 'task' || !canDropInGroup(i)) return;
        e.preventDefault();
        const d = dragging;
        endDrag();
        dropInGroup(d, i);
      });
    }
    root.append(sec);
  });
  if (!items.length) root.insertAdjacentHTML('beforeend', '<p class="muted tv-empty">Görev yok.</p>');
  return items.filter(x => !x.task.done).length;
}

// Panoda sütuna bırakma: görevin ilgili alanını değiştirir
const canDropInGroup = i => !(todoGroup === 'day' && i === 0);   // "Gecikenler"e bırakılamaz
function dropInGroup({ cat, task }, i) {
  const today = todayISO();
  let wantDone = !!task.done;
  if (todoGroup === 'day') {
    if (i === 6) wantDone = true;
    else {
      wantDone = false;
      if (i === 5) { delete task.due; delete task.time; delete task.remind; }
      else task.due = addDays(today, [0, 0, 1, 7, 14][i]);
    }
  } else if (todoGroup === 'prio') {
    task.priority = 3 - i || undefined;
  } else wantDone = i !== 0;   // "Açık" ↔ tamamlanan gruplar
  if (wantDone !== !!task.done) setDone(cat, task, wantDone); else saveTodos();
}
