// ============ Görev hatırlatıcıları ============
// Zamanı gelen hatırlatıcılar (task.remind) sistem bildirimi olarak gösterilir. Uygulama açıkken (tepsiye küçülmüş olsa da) her 20 sn kontrol edilir.
// Her hatırlatıcı bir kez çalar (çalanlar localStorage'da tutulur); uygulama kapalıyken kaçan hatırlatıcı, 6 saat içinde açılırsa gösterilir.
const REMIND_GRACE = 6 * 3600e3;
const REMIND_KEEP = 3 * 86400e3;   // çalındı kaydı bu kadar süre tutulur

// Zamanı gelmiş (henüz bekleyen) hatırlatıcılar; tamamlanmış görevler sayılmaz
function dueReminders(now = Date.now()) {
  const out = [];
  for (const { cat, task } of allTasks()) {
    if (task.done || !task.remind?.length) continue;
    for (const tok of task.remind) {
      const at = remindAt(task, tok);
      if (!at || isNaN(at) || at.getTime() > now) continue;
      out.push({ cat, task, at: at.getTime(), key: `${task.created || ''}|${task.text}|${tok}|${at.getTime()}` });
    }
  }
  return out;
}

function checkReminders() {
  const fired = store.get('firedReminders', {});
  const now = Date.now();
  let changed = false;
  for (const r of dueReminders(now)) {
    if (fired[r.key]) continue;
    fired[r.key] = now;
    changed = true;
    if (now - r.at > REMIND_GRACE) continue;
    const when = r.task.due ? `${dueInfo(r.task.due, false).label}${r.task.time ? ' ' + r.task.time : ''}` : '';
    api.notify.show(r.task.text.replace(/[*_`~]/g, ''), [r.cat.name, when].filter(Boolean).join(' · ')).catch(console.error);
  }
  for (const k of Object.keys(fired)) if (now - fired[k] > REMIND_KEEP) { delete fired[k]; changed = true; }
  if (changed) store.set('firedReminders', fired);
}
setTimeout(checkReminders, 3000);
setInterval(checkReminders, 20000);
