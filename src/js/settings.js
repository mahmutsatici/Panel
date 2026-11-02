// ============ Ayarlar ============
// Koyu zeminli temalar (editör koyu görünümünü kullanır); diğerleri açık zeminli.
const DARK_THEMES = new Set(['dark', 'navy', 'graphite', 'forest', 'plum']);
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
  $('#geminiKeyInput').value = settings.geminiApiKey || '';
  $('#geminiStatus').textContent = settings.geminiApiKey ? '' : 'Henüz anahtar girilmedi; sesli asistan çalışmaz.';
  $('#voiceShortcutLbl').textContent = settings.voiceShortcut.replace('Control', 'Ctrl');
  $('#ttsVoice').value = settings.ttsVoice || 'Kore';
  $('#sparkSilence').value = String(settings.sparkSilenceMs ?? 1500);
  renderLayoutSettings();
  renderNotifyBackup();
}

// --- Hesap (bulut girişi; isteğe bağlı) ---
function renderAccount() {
  const out = $('#acctSignedOut'), inn = $('#acctSignedIn'), st = $('#acctStatus');
  if (!cloud.enabled) {
    out.hidden = inn.hidden = true;
    st.textContent = 'Bu sürümde bulut hesabı yapılandırılmamış; Panel tamamen yerel çalışıyor.';
    return;
  }
  st.textContent = cloud.ready ? '' : 'Oturum kontrol ediliyor…';
  out.hidden = !!cloud.user || !cloud.ready;
  inn.hidden = !cloud.user;
  $('#acctUser').textContent = cloud.user ? `${cloud.user.ad ? cloud.user.ad + ' · ' : ''}${cloud.user.email}` : '';
  // Giriş yapılmış ama izin listesinde değilse (ya da liste okunamadıysa) ortak kategoriler kapalı kalır
  if (cloud.user && !cloud.user.active) {
    st.classList.add('err');
    st.textContent = cloud.user.error ? `Hesap bilgisi okunamadı (${cloud.user.error}).`
      : cloud.user.requested ? 'Hesabın yönetici onayını bekliyor; isteğin iletildi. Onaylandıktan sonra "Durumu yenile"ye bas. Panel yerel olarak çalışmaya devam eder.'
      : 'Bu hesap henüz ortak çalışmaya açılmamış; yöneticine söyle. Panel yerel olarak çalışmaya devam eder.';
  } else st.classList.remove('err');
  $('#acctRefresh').hidden = !(cloud.user && !cloud.user.active);
  $('#setNavAdmin').hidden = !cloud.user?.admin;
}
cloud.onChange(renderAccount);
async function acctSignIn() {
  const st = $('#acctStatus');
  st.classList.remove('err');
  st.textContent = 'Giriş yapılıyor…';
  const err = await cloud.signIn($('#acctEmail').value, $('#acctPass').value);
  $('#acctPass').value = '';
  if (err) { st.classList.add('err'); st.textContent = err; }
}
$('#acctSignIn').onclick = acctSignIn;
$('#acctPass').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); acctSignIn(); } });
$('#acctEmail').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#acctPass').focus(); } });
$('#acctReset').onclick = async () => {
  const st = $('#acctStatus');
  st.classList.remove('err');
  if (!$('#acctEmail').value.trim()) { st.classList.add('err'); st.textContent = 'Önce e-postanı yaz.'; return; }
  const err = await cloud.resetPassword($('#acctEmail').value);
  st.classList.toggle('err', !!err);
  st.textContent = err || 'Şifre sıfırlama e-postası gönderildi (gelen kutunu ve istenmeyenleri kontrol et).';
};
$('#acctSignOut').onclick = () => cloud.signOut();
$('#acctRefresh').onclick = () => cloud.loadProfile();

// --- Kategoriler: soldaki menü sağdaki sayfayı seçer; son açılan sayfa hatırlanır ---
function showSettingsPage(page) {
  $$('#setNav button').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  $$('.set-page').forEach(p => { p.hidden = p.dataset.page !== page; });
  store.set('settingsPage', page);
  if (page === 'admin') renderAdmin();
}
$$('#setNav button').forEach(b => b.onclick = () => showSettingsPage(b.dataset.page));

// --- SPARK (Gemini) ---
$('#ttsVoice').innerHTML = SPARK_VOICES.map(([id, tone]) => `<option value="${id}">${id} — ${tone}</option>`).join('');
$('#geminiKeyGet').onclick = () => api.openExternal('https://aistudio.google.com/app/apikey');
// Alanlar değişince (odaktan çıkınca / Enter) kendiliğinden kaydedilir; ayrı bir Kaydet düğmesi yok.
async function saveSpark(patch) {
  $('#geminiStatus').textContent = 'Kaydediliyor…';
  settings = await api.settings.set(patch);
  $('#geminiStatus').textContent = 'Kaydedildi ✓';
}
$('#geminiKeyInput').addEventListener('change', e => saveSpark({ geminiApiKey: e.target.value.trim() || null }));

$('#geminiTest').onclick = async () => {
  $('#geminiStatus').textContent = 'Deneniyor…';
  try {
    // Yazılmış ama henüz odaktan çıkmamış alanlar da denemeye dahil olsun
    settings = await api.settings.set({
      geminiApiKey: $('#geminiKeyInput').value.trim() || null,
    });
    const res = await api.assistant.test();
    $('#geminiStatus').textContent = res?.speech ? `✓ ${res.speech}` : '✓ Bağlantı kuruldu.';
  } catch (err) {
    $('#geminiStatus').textContent = `⚠ ${cleanErr(err)}`;
  }
};
$('#sparkSilence').onchange = async e => { settings = await api.settings.set({ sparkSilenceMs: Number(e.target.value) }); };
$('#ttsVoice').onchange = async e => { settings = await api.settings.set({ ttsVoice: e.target.value }); };
$('#ttsPreview').onclick = async () => {
  const b = $('#ttsPreview');
  b.disabled = true;
  try { await previewVoice($('#ttsVoice').value); } finally { b.disabled = false; }
};
$('#geminiTest').onclick = async () => {
  $('#geminiStatus').textContent = 'Deneniyor…';
  try {
    const res = await api.assistant.test();
    $('#geminiStatus').textContent = res?.speech ? `✓ ${res.speech}` : '✓ Bağlantı kuruldu.';
  } catch (err) {
    $('#geminiStatus').textContent = `⚠ ${cleanErr(err)}`;
  }
};

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
$('#settingsClose').onclick = () => $('#settingsDlg').close();
// Ayarlar diğer sayfalar gibi tam sayfa açılır (üst çubuk açık kalır); ⚙ yeniden basılınca, başka sayfaya geçilince ya da Esc ile kapanır
$('#openSettings').onclick = () => {
  if ($('#settingsDlg').open) return $('#settingsDlg').close();
  fillSettingsDialog();
  showSettingsPage(settings.userName ? store.get('settingsPage', 'general') : 'general');
  $('#settingsDlg').show();
  $('#openSettings').classList.add('on');
  document.body.classList.add('settings-open');
  if (!settings.userName) $('#nameInput').focus();
};
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#settingsDlg').open && !e.defaultPrevented && !document.querySelector('#datePop:not([hidden]), #timePop:not([hidden])')) $('#settingsDlg').close(); });

const saveName = debounce(async v => { settings = await api.settings.set({ userName: v.trim() }); }, 400);
$('#nameInput').addEventListener('input', e => {
  settings.userName = e.target.value;
  renderGreeting();
  saveName(e.target.value);
});
$('#wRefresh').onclick = () => loadWeather(true);
$('#openData').onclick = () => api.openDataDir();
$('#quitApp').onclick = () => api.quit();
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

// Pencere Esc ile ya da dışarıdan kapanırsa, odaktan çıkmadığı için kaydedilmemiş bir anahtar/model kalmasın
$('#settingsDlg').addEventListener('close', () => {
  $('#openSettings').classList.remove('on');
  document.body.classList.remove('settings-open');
  const key = $('#geminiKeyInput').value.trim() || null;
  if (key !== (settings.geminiApiKey || null)) api.settings.set({ geminiApiKey: key }).then(s => { settings = s; });
});
