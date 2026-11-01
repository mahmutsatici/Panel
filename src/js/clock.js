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

// Saniyeli dijital görünüm: gerçek bir LCD saat gibi yedi parçalı (7 segment) rakamlar; sönük parçalar silik görünür, iki nokta saniyede bir yanıp söner
const LCD_SEGS = {   // her rakamın yanan parçaları (a üst, b sağ üst, c sağ alt, d alt, e sol alt, f sol üst, g orta)
  0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
};
const LCD_POLY = {
  a: '16,10 21,5 43,5 48,10 43,15 21,15', g: '16,54 21,49 43,49 48,54 43,59 21,59', d: '16,98 21,93 43,93 48,98 43,103 21,103',
  f: '8,15 13,20 13,46 8,51 3,46 3,20', b: '56,15 61,20 61,46 56,51 51,46 51,20',
  e: '8,57 13,62 13,88 8,93 3,88 3,62', c: '56,57 61,62 61,88 56,93 51,88 51,62',
};
const lcdDigit = n => `<svg class="lcd-d" viewBox="0 0 64 104" aria-hidden="true">${Object.entries(LCD_POLY).map(([k, pts]) => `<polygon class="${LCD_SEGS[n].includes(k) ? 'on' : 'off'}" points="${pts}"/>`).join('')}</svg>`;
const lcdColon = on => `<svg class="lcd-c${on ? ' on' : ''}" viewBox="0 0 16 104" aria-hidden="true"><rect x="3" y="30" width="10" height="10" rx="2"/><rect x="3" y="64" width="10" height="10" rx="2"/></svg>`;
function lcdHtml(h, m, s) {
  const d = String(h).padStart(2, '0') + String(m).padStart(2, '0') + String(s).padStart(2, '0');
  const on = s % 2 === 0;
  return lcdDigit(d[0]) + lcdDigit(d[1]) + lcdColon(on) + lcdDigit(d[2]) + lcdDigit(d[3]) + lcdColon(on) + lcdDigit(d[4]) + lcdDigit(d[5]);
}

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
  if (mode === 'seconds') $('#lcd').innerHTML = lcdHtml(now.getHours(), now.getMinutes(), now.getSeconds());
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
