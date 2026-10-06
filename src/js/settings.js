// ============ Ayarlar ============
// Koyu zeminli temalar (editör koyu görünümünü kullanır); diğerleri açık zeminli.
const DARK_THEMES = new Set(['dark', 'navy']);
function applyTheme() {
  const t = settings.theme === 'system'
    ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : settings.theme;
  const dark = DARK_THEMES.has(t);
  document.documentElement.dataset.theme = t;
  document.documentElement.dataset.tone = dark ? 'dark' : 'light';
  document.querySelector('.toastui-editor-defaultUI')?.classList.toggle('toastui-editor-dark', dark);
  syncTitleBar();
}

// Pencerenin üst çubuğu (küçült/büyüt/kapat düğmelerinin arkası) temanın zemin rengini alsın.
// Renk doğrudan CSS'ten okunur; böylece tema renkleri tek yerde (styles.css) tanımlı kalır.
let lastTitleBar = '';
function syncTitleBar() {
  const css = getComputedStyle(document.documentElement);
  const color = css.getPropertyValue('--bg').trim(), symbol = css.getPropertyValue('--text').trim();
  if (!color || !symbol || color + symbol === lastTitleBar) return;
  lastTitleBar = color + symbol;
  api.setTitleBar(color, symbol).catch(() => {});
}
matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);

function fillSettingsDialog() {
  $('#themeSelect').value = settings.theme;
  $('#autostartChk').checked = settings.autostart;
  $('#autostartNote').textContent = settings.isPackaged ? '' : 'Not: Otomatik başlatma yalnızca kurulmuş sürümde (npm run dist) etkin olur.';
  $('#shortcutLbl').textContent = settings.shortcut.replace('Control', 'Ctrl');
  $('#cityCurrent').textContent = settings.city ? `Seçili: ${settings.city.name}${settings.city.region ? ', ' + settings.city.region : ''}` : 'Şehir seçilmedi.';
  $('#cityResults').innerHTML = '';
  $('#nameInput').value = settings.userName || '';
  renderLayoutSettings();
  renderNotifyBackup();
}

// --- Sabah bildirimi & otomatik yedek ---
function renderNotifyBackup() {
  const n = settings.notify || {}, b = settings.backup || {};
  $('#notifyChk').checked = !!n.enabled;
  $('#notifyTime').value = n.time || '09:00';
  $('#backupChk').checked = !!b.enabled;
  $('#backupDir').value = b.dir || '';
  $('#backupDir').title = b.dir || '';
  $('#backupNow').disabled = $('#backupOpen').disabled = !b.dir;
  const st = $('#backupStatus');
  st.classList.toggle('err', !!b.error);
  st.textContent = b.error ? `⚠ Son yedek alınamadı: ${b.error}`
    : b.lastAt ? `Son yedek: ${fmtStampStr(b.lastAt.replace(' ', 'T'))} → ${b.dir}\\Panel yedekleri`
    : b.dir ? 'Henüz yedek alınmadı.' : 'Yedeklemek için bir klasör seç (ör. Google Drive / OneDrive klasörün).';
}
const validTime = v => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
async function saveNotifyTime(v) {
  if (!validTime(v)) { $('#notifyTime').value = settings.notify.time; return; }
  settings = await api.notify.config({ time: v });
  renderNotifyBackup();
}
$('#notifyChk').onchange = async e => { settings = await api.notify.config({ enabled: e.target.checked }); renderNotifyBackup(); };
$('#notifyTime').addEventListener('change', e => saveNotifyTime(e.target.value.trim().replace('.', ':')));
$('#notifyTime').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
document.querySelectorAll('.time-row .step').forEach(b => b.onclick = () => {
  const [h, m] = (settings.notify.time || '09:00').split(':').map(Number);
  const t = ((h * 60 + m + Number(b.dataset.step)) % 1440 + 1440) % 1440;
  saveNotifyTime(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
});
$('#notifyTest').onclick = () => api.notify.test();

$('#backupChk').onchange = async e => {
  if (e.target.checked && !settings.backup.dir) { e.target.checked = false; return $('#backupChoose').click(); }
  $('#backupStatus').textContent = 'Kaydediliyor…';
  settings = await api.backup.config({ enabled: e.target.checked });
  renderNotifyBackup();
};
$('#backupChoose').onclick = async () => {
  $('#backupStatus').textContent = 'Klasör seçiliyor…';
  settings = await api.backup.choose();
  renderNotifyBackup();
};
$('#backupNow').onclick = async () => {
  $('#backupStatus').textContent = 'Yedekleniyor…';
  settings = await api.backup.now();
  renderNotifyBackup();
};
$('#backupOpen').onclick = () => api.backup.open();
// İsim boşsa ayarlar ilk açılışta isim alanına odaklansın
$('#openSettings').onclick = () => {
  fillSettingsDialog();
  $('#settingsDlg').showModal();
  (settings.userName ? $('#cityInput') : $('#nameInput')).focus();
};

const saveName = debounce(async v => { settings = await api.settings.set({ userName: v.trim() }); }, 400);
$('#nameInput').addEventListener('input', e => {
  settings.userName = e.target.value;
  renderGreeting();
  saveName(e.target.value);
});
$('#wRefresh').onclick = () => loadWeather(true);
$('#openData').onclick = () => api.openDataDir();
$('#themeSelect').onchange = async e => { settings = await api.settings.set({ theme: e.target.value }); applyTheme(); };
$('#autostartChk').onchange = async e => { settings = await api.settings.set({ autostart: e.target.checked }); };

async function searchCity() {
  const q = $('#cityInput').value.trim();
  if (!q) return;
  const ul = $('#cityResults');
  ul.innerHTML = '<li class="muted">Aranıyor…</li>';
  try {
    const res = await fetch('https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({ name: q, count: 8, language: 'tr', format: 'json' }));
    const { results = [] } = await res.json();
    ul.innerHTML = results.length ? '' : '<li class="muted">Sonuç yok.</li>';
    results.forEach(r => {
      const region = [r.admin1, r.country].filter(Boolean).join(', ');
      const li = document.createElement('li');
      li.innerHTML = '<span></span> <small></small>';
      li.querySelector('span').textContent = r.name;
      li.querySelector('small').textContent = region;
      li.onclick = async () => {
        settings = await api.settings.set({ city: { name: r.name, region, lat: r.latitude, lon: r.longitude } });
        fillSettingsDialog();
        $('#cityInput').value = '';
        loadWeather(true);
      };
      ul.append(li);
    });
  } catch {
    ul.innerHTML = '<li class="muted">Arama başarısız. İnternet bağlantını kontrol et.</li>';
  }
}
$('#citySearch').onclick = searchCity;
$('#cityInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); searchCity(); } });
