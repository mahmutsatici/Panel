// ============ Takvim ============
// Ay görünümü; son tarihi olan görevler günlerin altında nokta olarak görünür.
// Bir güne tıklayınca o güne ait görevler kartın altında listelenir; oradan işaretlenebilir / eklenebilir.
const fmtMonth = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' });
const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
let calMonth = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })();
let calSelected = todayISO();
let calDayOpen = false;   // seçili günün görev penceresi açık mı
let calAddCat = null;     // gün penceresinden eklenecek görevin kategorisi

function calGoToday() {
  const d = new Date();
  calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  calSelected = todayISO();
  renderCalendar();
}
function closeCalDay() {
  if (!calDayOpen) return;
  calDayOpen = false;
  $('#calDay').hidden = true;
  document.querySelectorAll('.cal-d.sel').forEach(c => c.classList.remove('sel'));   // pencere kapanınca seçim işareti de kalkar
}
// Pencere dışına tıklayınca / Esc ile kapansın
document.addEventListener('mousedown', e => {
  if (calDayOpen && !e.target.closest('#calDay, .cal-d, #datePop')) closeCalDay();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCalDay(); });
window.addEventListener('resize', () => calDayOpen && positionCalDay());

// Pencereyi seçili günün hücresinin altına (yer yoksa üstüne) yerleştir
function positionCalDay() {
  const box = $('#calDay');
  const cell = document.querySelector(`.cal-d[data-iso="${calSelected}"]`);
  const card = cell?.closest('.card');
  if (!cell || !card || card.hidden) return closeCalDay();
  const c = card.getBoundingClientRect(), r = cell.getBoundingClientRect();
  const width = Math.max(280, Math.min(380, c.width - 16));
  box.style.width = `${width}px`;
  box.style.left = `${Math.min(Math.max(8, r.left + r.width / 2 - width / 2), innerWidth - width - 8)}px`;
  const h = box.offsetHeight;
  const below = r.bottom + 6;
  box.style.top = `${below + h > innerHeight - 8 ? Math.max(8, r.top - h - 6) : below}px`;
}
$('#calPrev').onclick = () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); renderCalendar(); };
$('#calNext').onclick = () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); renderCalendar(); };
$('#calToday').onclick = calGoToday;

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
    const sorted = partition(items.map(x => x.task)).map(t => items.find(x => x.task === t));
    const chips = sorted.slice(0, 4).map(({ cat, task }) => {
      const late = !task.done && iso < today;
      return `<span class="cal-item${task.done ? ' done' : ''}${late ? ' late' : ''}" style="--c:${catColor(cat)}">${esc(task.text)}</span>`;
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
function openCalDay(iso) {
  calSelected = iso;
  calDayOpen = true;
  const d = parseISODate(iso);
  if (d.getMonth() !== calMonth.getMonth()) calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  renderCalendar();
}

// Seçili günün görevleri (+ bugün seçiliyse gecikmiş görevler)
function renderCalDay(byDue) {
  const box = $('#calDay');
  const items = byDue.get(calSelected) || [];
  const today = todayISO();
  const overdue = calSelected === today
    ? allTasks().filter(x => x.task.due && x.task.due < today && !x.task.done)
    : [];
  const diff = dayDiff(calSelected);
  const rel = diff === 0 ? ' · Bugün' : diff === 1 ? ' · Yarın' : diff === -1 ? ' · Dün' : '';

  box.hidden = false;
  box.innerHTML = `
    <div class="cal-day-head"><b>${fmtLongDay.format(parseISODate(calSelected))}</b><span class="muted">${rel}</span>
      <button type="button" class="icon-btn cal-close" title="Kapat (Esc)">✕</button></div>
    <ul class="cal-tasks"></ul>
    <form class="cal-add">
      <div class="cal-cats"><span class="muted">Kategori</span></div>
      <input placeholder="Bu güne görev ekle… (Enter)" autocomplete="off">
    </form>`;

  // Eklenecek görevin kategorisi: küçük seçim düğmeleri (varsayılan: formda seçili kategori)
  const cats = activeCats();
  if (!cats.some(c => c.name === calAddCat)) calAddCat = currentCat().name;
  const catBox = box.querySelector('.cal-cats');
  for (const c of cats) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cal-cat' + (c.name === calAddCat ? ' on' : '');
    b.style.setProperty('--c', catColor(c));
    b.innerHTML = '<span class="dot"></span><span></span>';
    b.lastChild.textContent = c.name;
    b.onclick = () => {
      calAddCat = c.name;
      catBox.querySelectorAll('.cal-cat').forEach(x => x.classList.toggle('on', x === b));
      box.querySelector('.cal-add input').focus();
    };
    catBox.append(b);
  }

  const ul = box.querySelector('ul');
  const row = ({ cat, task }, late) => {
    const li = document.createElement('li');
    li.className = (task.done ? 'done' : '') + (late ? ' late' : '');
    li.style.setProperty('--c', catColor(cat));
    li.title = taskTitle(task).replace('\nDüzenlemek için tıkla', '') + '\n(Başka bir güne sürükleyebilirsin)';
    li.draggable = true;
    li.innerHTML = `<input type="checkbox" ${task.done ? 'checked' : ''}><span class="txt">${renderInline(task.text)}</span>`
      + (task.rec ? `<span class="rec" title="${esc(recLabel(task.rec))}">↻</span>` : '')
      + (late ? `<span class="late-tag">${dueInfo(task.due, false).label}</span>` : '')
      + `<span class="cat-tag"><span class="dot"></span>${esc(cat.name)}</span>`;
    li.querySelector('input').onchange = e => setDone(cat, task, e.target.checked);
    li.addEventListener('dragstart', e => { dragging = { type: 'task', cat, task }; e.dataTransfer.effectAllowed = 'move'; li.classList.add('dragging'); });
    li.addEventListener('dragend', endDrag);
    ul.append(li);
  };
  if (overdue.length) {
    ul.insertAdjacentHTML('beforeend', `<li class="sub">Gecikmiş (${overdue.length})</li>`);
    overdue.forEach(x => row(x, true));
    if (items.length) ul.insertAdjacentHTML('beforeend', '<li class="sub">Bugün</li>');
  }
  partition(items.map(x => x.task)).forEach(t => row(items.find(x => x.task === t), false));
  if (!items.length && !overdue.length) ul.innerHTML = '<li class="empty-day">Bu güne ait görev yok</li>';

  box.querySelector('.cal-close').onclick = closeCalDay;
  positionCalDay();
  box.querySelector('.cal-add').onsubmit = e => {
    e.preventDefault();
    const input = e.target.querySelector('input');
    const parsed = parseTaskBody(input.value.trim());
    const nl = parseNatural(parsed.text);   // "her hafta" gibi tekrar ifadeleri de tanınsın
    const text = nl.text || parsed.text;
    if (!text) return;
    const cat = activeCats().find(c => c.name === calAddCat) || currentCat();
    addTask(cat, text, calSelected, parsed.rec || nl.rec).then(() => $('#calDay .cal-add input')?.focus());
  };
}
