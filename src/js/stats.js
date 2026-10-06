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
    </div>`;
}
