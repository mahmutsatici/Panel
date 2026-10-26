// ============ Özet kartı ============
// Görevlerin arka planda tutulan eklenme/tamamlanma zamanlarından:
//   · bu hafta tamamlanan görev sayısı (geçen haftayla kıyas)
//   · haftanın günlerine göre küçük sütun grafiği
//   · bir görevin ortalama kaç günde bittiği (son 30 gün), açık ve geciken görev sayısı
const STAT_DAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

function formatDuration(hours) {
  if (hours < 1) return '1 saatten az';
  if (hours < 24) return `${Math.round(hours)} saat`;
  const days = hours / 24;
  return `${days.toLocaleString('tr-TR', { maximumFractionDigits: days < 10 ? 1 : 0 })} gün`;
}

function computeStats() {
  const today = todayISO();
  const weekStart = addDays(today, -((parseISODate(today).getDay() + 6) % 7));
  const lastWeekStart = addDays(weekStart, -7);
  const perDay = Array(7).fill(0);
  let thisWeek = 0, lastWeek = 0, open = 0, overdue = 0;
  const durations = [];
  const monthAgo = addDays(today, -30);

  for (const { task } of allTasks()) {
    if (!task.done) {
      open++;
      if (task.due && task.due < today) overdue++;
      continue;
    }
    if (!task.completed) continue;
    const day = task.completed.slice(0, 10);
    if (day >= weekStart) {
      const i = dayDiffBetween(weekStart, day);
      if (i >= 0 && i < 7) { perDay[i]++; thisWeek++; }
    } else if (day >= lastWeekStart) lastWeek++;
    if (task.created && day >= monthAgo) {
      const h = (new Date(task.completed) - new Date(task.created)) / 36e5;
      if (h >= 0) durations.push(h);
    }
  }
  const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
  return { perDay, thisWeek, lastWeek, open, overdue, avg, avgCount: durations.length, todayIndex: dayDiffBetween(weekStart, today) };
}
// Tam ekran için ek istatistikler: günlük seri, aylık toplam, son 12 hafta, yaklaşan günler, kategori dökümü
const fmtWeekLabel = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' });
const fmtDayShort = new Intl.DateTimeFormat('tr-TR', { weekday: 'short', day: 'numeric' });
function computeMoreStats() {
  const today = todayISO();
  const doneByDay = new Map();
  for (const { task } of allTasks()) {
    if (!task.done || !task.completed) continue;
    const d = task.completed.slice(0, 10);
    doneByDay.set(d, (doneByDay.get(d) || 0) + 1);
  }
  let monthDone = 0;
  for (const [d, n] of doneByDay) if (d.slice(0, 7) === today.slice(0, 7)) monthDone += n;
  // Seri: bugünden (bugün henüz yoksa dünden) geriye doğru her gün en az bir görev bitirilmiş gün sayısı
  let streak = 0;
  for (let d = doneByDay.has(today) ? today : addDays(today, -1); doneByDay.has(d); d = addDays(d, -1)) streak++;
  let best = 0, run = 0, prev = null;
  for (const d of [...doneByDay.keys()].sort()) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  const weekStart = addDays(today, -((parseISODate(today).getDay() + 6) % 7));
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const ws = addDays(weekStart, -7 * (11 - i));
    let n = 0;
    for (let k = 0; k < 7; k++) n += doneByDay.get(addDays(ws, k)) || 0;
    return { ws, n };
  });
  const openAll = allTasks().filter(x => !x.task.done);
  const upcoming = Array.from({ length: 7 }, (_, i) => {
    const iso = addDays(today, i);
    return { iso, n: openAll.filter(x => x.task.due === iso).length };
  });
  const cats = activeCats().map(cat => {
    const r = { cat, open: 0, late: 0, done: 0, week: 0 };
    for (const t of cat.tasks) {
      if (!t.done) { r.open++; if (t.due && t.due < today) r.late++; }
      else { r.done++; if (t.completed && t.completed.slice(0, 10) >= weekStart) r.week++; }
    }
    return r;
  });
  return { todayDone: doneByDay.get(today) || 0, monthDone, streak, best, weeks, upcoming, cats };
}
function renderMoreStats(base) {
  const m = computeMoreStats();
  const tile = (val, label, cls = '') => `<div class="st-tile ${cls}"><b>${val}</b><span>${label}</span></div>`;
  const wMax = Math.max(1, ...m.weeks.map(w => w.n));
  const uMax = Math.max(1, ...m.upcoming.map(u => u.n));
  const weeks = m.weeks.map((w, i) => `<div class="st-wk${i === 11 ? ' now' : ''}" title="${fmtWeekLabel.format(parseISODate(w.ws))} haftası: ${w.n} görev">
      <span class="st-wv">${w.n || ''}</span><div class="st-wb" style="height:${w.n ? Math.max(4, (w.n / wMax) * 100) : 0}%"></div>
      <span class="st-wl">${fmtWeekLabel.format(parseISODate(w.ws))}</span></div>`).join('');
  const upcoming = m.upcoming.map((u, i) => `<div class="st-up-row"><span>${i === 0 ? 'Bugün' : i === 1 ? 'Yarın' : fmtDayShort.format(parseISODate(u.iso))}</span>
      <div class="st-up-bar"><i style="width:${(u.n / uMax) * 100}%"></i></div><b>${u.n}</b></div>`).join('');
  const rows = m.cats.map(r => {
    const total = r.open + r.done;
    return `<tr><td><span class="dot" style="--c:${catColor(r.cat)}"></span>${esc(r.cat.name)}</td><td>${r.open}</td>
      <td class="${r.late ? 'late' : ''}">${r.late}</td><td>${r.week}</td><td>${r.done}</td>
      <td><div class="st-prog" title="%${total ? Math.round((r.done / total) * 100) : 0} tamamlandı"><i style="width:${total ? (r.done / total) * 100 : 0}%"></i></div></td></tr>`;
  }).join('');
  return `<div class="st-full">
    <div class="st-tiles">
      ${tile(m.todayDone, 'bugün tamamlandı')}
      ${tile(m.monthDone, 'bu ay tamamlandı')}
      ${tile(`${m.streak} gün`, 'üst üste görev bitirme serisi')}
      ${tile(`${m.best} gün`, 'en uzun seri')}
      ${tile(base.open, 'açık görev')}
      ${tile(base.overdue, 'geciken görev', base.overdue ? 'late' : '')}
    </div>
    <div class="st-two">
      <section><h3>Son 12 hafta (tamamlanan)</h3><div class="st-weeks">${weeks}</div></section>
      <section><h3>Önümüzdeki 7 gün (son tarihi olan açık görevler)</h3><div class="st-up">${upcoming}</div></section>
    </div>
    <section><h3>Kategoriler</h3>
      <table class="st-cats"><thead><tr><th>Kategori</th><th>Açık</th><th>Geciken</th><th>Bu hafta biten</th><th>Toplam biten</th><th>İlerleme</th></tr></thead><tbody>${rows}</tbody></table>
    </section>
  </div>`;
}
const dayDiffBetween = (a, b) => Math.round((parseISODate(b) - parseISODate(a)) / 864e5);

function renderStats() {
  const box = $('#statsBody');
  if (!box) return;
  const s = computeStats();
  const max = Math.max(1, ...s.perDay);
  const delta = s.thisWeek - s.lastWeek;
  const deltaTxt = !s.lastWeek && !s.thisWeek ? 'henüz tamamlanan yok'
    : delta === 0 ? `geçen haftayla aynı (${s.lastWeek})`
    : `geçen hafta ${s.lastWeek} · ${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}`;

  const bars = s.perDay.map((n, i) => {
    const future = i > s.todayIndex;
    const h = n ? Math.max(6, Math.round((n / max) * 100)) : 0;
    const tip = future ? `${STAT_DAYS[i]}: henüz gelmedi` : `${STAT_DAYS[i]}: ${n} görev tamamlandı`;
    return `<div class="st-col${i === s.todayIndex ? ' today' : ''}${future ? ' future' : ''}" data-tip="${tip}">
      <div class="st-bar-wrap">${i === s.todayIndex && n ? `<span class="st-val">${n}</span>` : ''}<div class="st-bar" style="height:${h}%"></div></div>
      <span class="st-day">${STAT_DAYS[i]}</span>
    </div>`;
  }).join('');

  box.innerHTML = `
    <div class="st-hero">
      <div class="st-num">${s.thisWeek}</div>
      <div class="st-lbl">bu hafta tamamlandı</div>
      <div class="st-delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">${deltaTxt}</div>
    </div>
    <div class="st-chart" role="img" aria-label="Bu hafta günlere göre tamamlanan görevler: ${s.perDay.map((n, i) => `${STAT_DAYS[i]} ${n}`).join(', ')}">${bars}</div>
    <div class="st-side">
      <div class="st-kv"><b>${s.avg === null ? '—' : formatDuration(s.avg)}</b><span>ortalama bitirme süresi${s.avgCount ? ` (son 30 gün, ${s.avgCount} görev)` : ''}</span></div>
      <div class="st-kv"><b>${s.open}</b><span>açık görev${s.overdue ? ` · <em class="late">${s.overdue} geciken</em>` : ''}</span></div>
    </div>` + renderMoreStats(s);   // tam ekran ayrıntıları (panoda CSS ile gizli)
}
