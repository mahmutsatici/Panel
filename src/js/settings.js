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
  $('#geminiKeyInput').value = settings.geminiApiKey || '';
  $('#geminiModelInput').value = settings.geminiModel || '';
  $('#geminiStatus').textContent = settings.geminiApiKey ? '' : 'Henüz anahtar girilmedi; sesli asistan çalışmaz.';
  $('#voiceShortcutLbl').textContent = settings.voiceShortcut.replace('Control', 'Ctrl');
  $('#ttsEnabled').checked = settings.ttsEnabled !== false;
  $('#ttsVoice').value = settings.ttsVoice || 'Kore';
  renderTtsModels();
  renderMusicLists();
  refreshYtmStatus();
  $('#sparkSilence').value = String(settings.sparkSilenceMs ?? 1500);
  renderLayoutSettings();
  renderNotifyBackup();
}

// --- Kategoriler: soldaki menü sağdaki sayfayı seçer; son açılan sayfa hatırlanır ---
function showSettingsPage(page) {
  $$('#setNav button').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  $$('.set-page').forEach(p => { p.hidden = p.dataset.page !== page; });
  store.set('settingsPage', page);
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
$('#geminiModelInput').addEventListener('change', e => saveSpark({ geminiModel: e.target.value.trim() || null }));

// Ses modelleri: ana süreçte virgülle ayrılmış metin olarak durur, burada liste olarak düzenlenir
const ttsModelList = () => String(settings.ttsModels || '').split(',').map(m => m.trim()).filter(Boolean);
function renderTtsModels() {
  const ul = $('#ttsModelList'), models = ttsModelList();
  ul.innerHTML = models.length
    ? models.map((m, i) => `<li><span>${esc(m)}</span><button type="button" class="icon-btn" data-i="${i}" title="Listeden çıkar">✕</button></li>`).join('')
    : '<li class="muted">Model yok — SPARK Windows sesiyle konuşur.</li>';
}
async function saveTtsModels(models) {
  settings = await api.settings.set({ ttsModels: models.join(',') });
  renderTtsModels();
}
$('#ttsModelList').onclick = e => {
  const i = e.target.closest('button')?.dataset.i;
  if (i != null) saveTtsModels(ttsModelList().filter((_, j) => j !== Number(i)));
};
function addTtsModel() {
  const v = $('#ttsModelAdd').value.trim();
  if (!v) return;
  $('#ttsModelAdd').value = '';
  if (!ttsModelList().includes(v)) saveTtsModels([...ttsModelList(), v]);
}
$('#ttsModelAddBtn').onclick = addTtsModel;
$('#ttsModelAdd').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addTtsModel(); } });

$('#geminiTest').onclick = async () => {
  $('#geminiStatus').textContent = 'Deneniyor…';
  try {
    // Yazılmış ama henüz odaktan çıkmamış alanlar da denemeye dahil olsun
    settings = await api.settings.set({
      geminiApiKey: $('#geminiKeyInput').value.trim() || null,
      geminiModel: $('#geminiModelInput').value.trim() || null,
    });
    const res = await api.assistant.test();
    $('#geminiStatus').textContent = res?.speech ? `✓ ${res.speech}` : '✓ Bağlantı kuruldu.';
  } catch (err) {
    $('#geminiStatus').textContent = `⚠ ${cleanErr(err)}`;
  }
};
$('#sparkSilence').onchange = async e => { settings = await api.settings.set({ sparkSilenceMs: Number(e.target.value) }); };
// Müzik listeleri: [{ name, id }] — bağlantıdan list= kimliği ayıklanır
function renderMusicLists() {
  const lists = settings.musicLists || [];
  $('#musicListEl').innerHTML = lists.length
    ? lists.map((l, i) => `<li><span><b>${esc(l.name)}</b> <span class="muted">${esc(l.id.slice(0, 14))}…</span></span><button type="button" class="icon-btn" data-i="${i}" title="Listeden çıkar">✕</button></li>`).join('')
    : '<li class="muted">Liste eklenmedi — SPARK arama sonuçlarından çalar.</li>';
}
const listIdOf = v => {
  const t = v.trim();
  if (/^[A-Za-z0-9_-]{10,}$/.test(t)) return t;
  try { return new URL(t).searchParams.get('list'); } catch { return null; }
};
async function saveMusicLists(lists) {
  settings = await api.settings.set({ musicLists: lists });
  renderMusicLists();
}
$('#musicAdd').onclick = () => {
  const name = $('#musicName').value.trim(), id = listIdOf($('#musicUrl').value);
  if (!name || !id) { $('#ytmStatus').textContent = '⚠ Liste adı ve geçerli bir YouTube Music liste bağlantısı gerekli (…?list=… içermeli).'; return; }
  $('#musicName').value = $('#musicUrl').value = '';
  const lists = (settings.musicLists || []).filter(l => l.id !== id && l.name !== name);
  saveMusicLists([...lists, { name, id }]);
  refreshYtmStatus();
};
$('#musicListEl').onclick = e => {
  const i = e.target.closest('button')?.dataset.i;
  if (i != null) saveMusicLists((settings.musicLists || []).filter((_, j) => j !== Number(i)));
};
async function refreshYtmStatus() {
  const r = await api.assistant.system({ type: 'ytm_status' }).catch(() => ({ ok: false }));
  $('#ytmStatus').textContent = r.ok
    ? '✓ YouTube Music uygulaması bulundu; müzik orada açılır.'
    : 'YouTube Music uygulaması (Chrome ile kurulmuş) bulunamadı; müzik tarayıcıda yeni sekmede açılır.';
}
$('#ttsEnabled').onchange = async e => { settings = await api.settings.set({ ttsEnabled: e.target.checked }); };
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
$('#openSettings').onclick = () => {
  fillSettingsDialog();
  showSettingsPage(settings.userName ? store.get('settingsPage', 'general') : 'general');
  $('#settingsDlg').showModal();
  if (!settings.userName) $('#nameInput').focus();
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

// Pencere Esc ile ya da dışarıdan kapanırsa, odaktan çıkmadığı için kaydedilmemiş bir anahtar/model kalmasın
$('#settingsDlg').addEventListener('close', () => {
  const key = $('#geminiKeyInput').value.trim() || null, model = $('#geminiModelInput').value.trim() || null;
  if (key !== (settings.geminiApiKey || null) || model !== (settings.geminiModel || null)) {
    api.settings.set({ geminiApiKey: key, geminiModel: model }).then(s => { settings = s; });
  }
});
