// Saat, tarih ve karşılama
const fmtDate = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
let clockDay = null;

// Saat görünümleri: başlıktaki düğme sırayla değiştirir, seçim ayarlarda saklanır
const CLOCK_MODES = [['digital', 'Dijital'], ['seconds', 'Dijital (saniyeli)'], ['analog', 'Analog']];
const clockMode = () => (CLOCK_MODES.some(m => m[0] === settings.clockMode) ? settings.clockMode : 'digital');
const CLOCK_ICONS = {
  digital: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M8 10v4M11 10v4M14 10h3v4h-3"/></svg>',
  seconds: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M7 10v4M10 10v4M13.5 10.5v.1M13.5 13.5v.1M16 10v4M18.5 10v4"/></svg>',
  analog: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
};

// Analog kadran: 60 çizgi (saat başları kalın), 12/3/6/9 rakamları, akrep-yelkovan-saniye
function buildAnalog() {
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const big = i % 5 === 0;
    return `<line class="tk${big ? ' big' : ''}" x1="100" y1="${big ? 12 : 13}" x2="100" y2="${big ? 24 : 18}" transform="rotate(${i * 6} 100 100)"/>`;
  }).join('');
  const nums = [[12, 100, 42], [3, 160, 107], [6, 100, 170], [9, 40, 107]]
    .map(([n, x, y]) => `<text x="${x}" y="${y}">${n}</text>`).join('');
  $('#analog').innerHTML = `<circle class="face" cx="100" cy="100" r="95"/>${ticks}${nums}
    <line class="hand h" id="hHand" x1="100" y1="108" x2="100" y2="56"/>
    <line class="hand m" id="mHand" x1="100" y1="112" x2="100" y2="30"/>
    <line class="hand s" id="sHand" x1="100" y1="118" x2="100" y2="22"/>
    <circle class="pin" cx="100" cy="100" r="4.5"/>`;
}
function applyClockMode() {
  const mode = clockMode();
  $('.card.clock').dataset.mode = mode;
  const btn = $('#clockMode');
  btn.innerHTML = CLOCK_ICONS[mode];
  btn.title = `Saat görünümü: ${CLOCK_MODES.find(m => m[0] === mode)[1]} (değiştirmek için tıkla)`;
  tickClock();
}
$('#clockMode').onclick = async () => {
  const i = CLOCK_MODES.findIndex(m => m[0] === clockMode());
  settings = await api.settings.set({ clockMode: CLOCK_MODES[(i + 1) % CLOCK_MODES.length][0] });
  applyClockMode();
};

function tickClock() {
  const now = new Date();
  const p = n => String(n).padStart(2, '0');
  const mode = clockMode();
  $('#time').textContent = `${p(now.getHours())}:${p(now.getMinutes())}${mode === 'seconds' ? `:${p(now.getSeconds())}` : ''}`;
  if (mode === 'analog') {
    if (!$('#hHand')) buildAnalog();
    const s = now.getSeconds(), m = now.getMinutes() + s / 60, h = (now.getHours() % 12) + m / 60;
    $('#hHand').setAttribute('transform', `rotate(${h * 30} 100 100)`);
    $('#mHand').setAttribute('transform', `rotate(${m * 6} 100 100)`);
    $('#sHand').setAttribute('transform', `rotate(${s * 6} 100 100)`);
  }
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
