// Saat, tarih ve karşılama
const fmtDate = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
let clockDay = null;

function tickClock() {
  const now = new Date();
  const p = n => String(n).padStart(2, '0');
  $('#time').textContent = `${p(now.getHours())}:${p(now.getMinutes())}`;
  $('#date').textContent = fmtDate.format(now);
  $('#dayInfo').textContent = `${isoWeek(now)}. hafta`;
  // Gün değişince "Bugün / gecikti" etiketleri ve takvim güncellensin
  const today = todayISO();
  if (clockDay && clockDay !== today) { renderTodos(); calGoToday(); }
  clockDay = today;
}
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}

function renderGreeting() {
  const name = (settings.userName || '').trim();
  $('#greet').innerHTML = name ? `Hoş geldiniz, <b>${esc(name)}</b>` : 'Hoş geldiniz';
}
