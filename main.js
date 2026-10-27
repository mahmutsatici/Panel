const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, shell, nativeImage, screen, Notification, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');

// Yerleşik arayüz parçaları Türkçe olsun
app.commandLine.appendSwitch('lang', 'tr');
// Windows bildirimlerinde uygulama adı/simgesi doğru görünsün (package.json → build.appId ile aynı)
app.setAppUserModelId(app.isPackaged ? 'local.masaustu.panel' : 'local.masaustu.panel.dev');

const SHORTCUT = 'Control+Alt+P';
const VOICE_SHORTCUT = 'Control+Alt+V';   // sesli asistanı açar/kapatır (pencere gizliyken de çalışır)
// Logo dosyaları: paketlenmiş sürümde asar'ın dışında (resources/assets) durur, böylece pencere, tepsi ve
// bildirimler gerçek bir dosya yolundan okur. Geliştirmede proje klasöründeki assets kullanılır.
const ASSETS = app.isPackaged ? path.join(process.resourcesPath, 'assets') : path.join(__dirname, 'assets');
const ICON = path.join(ASSETS, 'icon.png');        // bildirimler
const ICON_ICO = path.join(ASSETS, 'icon.ico');    // pencere / görev çubuğu / tepsi (çok boyutlu)
const TITLEBAR_H = 44;                             // üst çubuk yüksekliği (CSS .topbar ile aynı)

// Test için ayrı bir veri klasörü: PANEL_PROFILE=C:\yol npm start (kurulu Panel ile çakışmaz)
if (process.env.PANEL_PROFILE) app.setPath('userData', process.env.PANEL_PROFILE);

let win = null;
let tray = null;
let quitting = false;

// ---------- Veri klasörü ----------
const dataDir = () => path.join(app.getPath('userData'), 'data');
const notesDir = () => path.join(dataDir(), 'notes');
const imagesDir = () => path.join(notesDir(), 'resimler');
const todoFile = () => path.join(dataDir(), 'todo.md');
const sharedCopyFile = () => path.join(dataDir(), 'ortak-kopya.json');   // ortak kategorilerin yerel yedeği (kaynak bulut)
const settingsFile = () => path.join(dataDir(), 'settings.json');

const DEFAULT_SETTINGS = {
  city: null, theme: 'dark', autostart: true, weatherCache: null,
  // Üst çubuğun (pencere başlık çubuğu) rengi: arayüz temadan okuyup bildirir, açılışta hemen uygulanır
  titleBar: { color: '#0e1016', symbolColor: '#e9ebf0' },
  notify: { enabled: true, time: '09:00', lastDate: null },
  backup: { enabled: false, dir: null, lastAt: null, lastDate: null, error: null },
  // SPARK (sesli asistan): ücretsiz Google AI Studio anahtarı kullanıcıdan alınır, asla pakete/koda gömülmez.
  // Model adı da ayardan değiştirilebilir — Google'ın güncel model kimliği Ayarlar'daki isimle
  // birebir aynı olmayabilir, kullanıcı Google AI Studio'daki tam kimliği yapıştırmalı.
  geminiApiKey: null, geminiModel: 'gemini-flash-lite-latest',
  // Ana model "yoğun talep" (503), kota (429) ya da bulunamadı (404) hatası verirse sırayla denenen yedek modeller (virgülle ayrılmış)
  geminiFallbackModels: 'gemini-flash-latest,gemini-2.5-flash-lite,gemini-2.5-flash',
  // SPARK'ın sesi (Gemini TTS). ttsModels virgülle ayrılmış listedir ve sırayla denenir: birinin günlük
  // ücretsiz kotası dolarsa sıradakine geçilir; hepsi doluysa arayüz yerel Windows sesine (Tolga) döner.
  ttsEnabled: true, ttsVoice: 'Kore',
  // Konuşma bitince (bu kadar ms sessizlikten sonra) kayıt kendiliğinden gönderilir; 0 = kapalı, düğmeyle bitirilir
  sparkSilenceMs: 1500,
  // SPARK'ın öncelik vereceği YouTube Music listeleri: [{ name: 'Chill', id: 'PL…' }]
  musicLists: [], ttsModels: 'gemini-2.5-flash-preview-tts',
};

async function ensureData() {
  await fs.mkdir(notesDir(), { recursive: true });
  try { await fs.access(todoFile()); } catch {
    await fs.writeFile(todoFile(), '# Yapılacaklar\n\n- [ ] Panel uygulamasını keşfet\n', 'utf8');
  }
  const notes = await fs.readdir(notesDir());
  if (!notes.some(f => f.endsWith('.md'))) {
    await fs.writeFile(path.join(notesDir(), 'Hoş geldin.md'),
      '# Hoş geldin 👋\n\nNotların **Markdown** olarak saklanır.\n\n- Listeler\n- `kod`\n- [bağlantılar](https://open-meteo.com)\n\n```js\nconsole.log("merhaba");\n```\n', 'utf8');
  }
}

async function readSettings() {
  let saved = {};
  try { saved = JSON.parse(await fs.readFile(settingsFile(), 'utf8')); }
  catch { saved = (await readJson(snapFile())) || {}; }   // dosya yok/bozuk → son sağlam kopya
  return {
    ...DEFAULT_SETTINGS, ...saved,
    titleBar: { ...DEFAULT_SETTINGS.titleBar, ...(saved.titleBar || {}) },
    notify: { ...DEFAULT_SETTINGS.notify, ...(saved.notify || {}) },
    backup: { ...DEFAULT_SETTINGS.backup, ...(saved.backup || {}) },
  };
}

// ---------- Başlat menüsü kısayolu ----------
// Windows görev çubuğu simgesini, uygulama kimliğiyle (AUMID) eşleşen Başlat menüsü kısayolundan alır.
// Kurulumun kısayolu yoksa/silinmişse Windows aynı kimliği taşıyan başka bir kısayolu (ör. geliştirme
// sırasında Electron'un kendiliğinden oluşturduğu "Electron.lnk") kullanıyor ve Electron logosu görünüyordu.
// Paketlenmiş sürüm her açılışta kendi kısayolunu doğru simgeyle yeniden yazar.
function ensureStartMenuShortcut() {
  if (!app.isPackaged || process.platform !== 'win32') return;
  try {
    const lnk = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Panel.lnk');
    shell.writeShortcutLink(lnk, 'create', {
      target: process.execPath,
      args: '--hidden',
      icon: process.execPath,
      iconIndex: 0,
      appUserModelId: 'local.masaustu.panel',
      description: 'Panel',
    });
  } catch {}
}

// ---------- Ayar güvenliği ----------
// Sürüm yükseltmesi, yarım yazılmış/bozuk dosya ya da başka bir kaza ayarları (ses modelleri, yedek klasörü,
// panel düzeni…) sıfırlayabiliyordu. Bu yüzden ayarlar her kayıtta iki yere daha aynalanır:
//   • AppData\Panel\settings-yedek\son.json        (kurulumdan ve veri klasöründen bağımsız)
//   • <yedek klasörü>\Panel yedekleri\ayarlar.json  (kullanıcının Drive vb. yedeğiyle birlikte gider)
// Açılışta ayarlar bozuk/eksik ya da sadece varsayılanlardan ibaretse son sağlam kopyadan geri yüklenir.
const snapDir = () => path.join(app.getPath('userData'), 'settings-yedek');
const snapFile = () => path.join(snapDir(), 'son.json');
const folderSnap = dir => path.join(backupRoot(dir), 'ayarlar.json');
async function readJson(p) { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return null; } }
// Kullanıcının kendi yaptığı hiçbir ayar yok mu (yalnızca varsayılanlar)?
const isPristine = s => !s || (!s.layout && !s.backup?.dir && !s.city && !s.userName && !s.geminiApiKey);
async function mirrorSettings(s) {
  const copy = { ...s };
  delete copy.weatherCache;   // büyük ve yeniden indirilebilir
  const text = JSON.stringify(copy, null, 2);
  await fs.mkdir(snapDir(), { recursive: true });
  await writeAtomic(snapFile(), text);
  if (s.backup?.dir) {
    await fs.mkdir(backupRoot(s.backup.dir), { recursive: true });
    await writeAtomic(folderSnap(s.backup.dir), text);
  }
}
// Açılışta çağrılır: ayar dosyası bozuk/eksik/sıfırlanmışsa en güncel sağlam kopyadan geri yükler.
async function recoverSettings() {
  const cur = await readJson(settingsFile());
  if (cur && !isPristine(cur)) return false;
  const candidates = [];
  const local = await readJson(snapFile());
  if (local) candidates.push({ s: local, p: snapFile() });
  const dir = cur?.backup?.dir || local?.backup?.dir;
  if (dir) { const f = await readJson(folderSnap(dir)); if (f) candidates.push({ s: f, p: folderSnap(dir) }); }
  const best = (await Promise.all(candidates.filter(c => !isPristine(c.s)).map(async c => ({ ...c, t: (await fs.stat(c.p)).mtimeMs }))))
    .sort((a, b) => b.t - a.t)[0];
  if (!best) return false;
  // Bozuk dosya silinmez, yanına alınır
  if (cur === null && await exists(settingsFile())) {
    await fs.mkdir(snapDir(), { recursive: true });
    await fs.copyFile(settingsFile(), path.join(snapDir(), `bozuk-${Date.now()}.json`)).catch(() => {});
  }
  await writeAtomic(settingsFile(), JSON.stringify({ ...(cur || {}), ...best.s }, null, 2));
  return true;
}
// Sürüm değiştiyse (yükseltme) o ana kadarki ayarlar ayrıca saklanır ve hemen bir yedek alınır.
async function onVersionChange() {
  const s = await readSettings();
  const v = app.getVersion();
  if (s.lastRunVersion === v) return;
  try {
    await fs.mkdir(snapDir(), { recursive: true });
    await fs.copyFile(settingsFile(), path.join(snapDir(), `surum-${s.lastRunVersion || 'ilk'}-oncesi.json`)).catch(() => {});
    // en son 5 sürüm kopyası tutulur
    const old = (await fs.readdir(snapDir())).filter(n => /^surum-.*-oncesi\.json$/.test(n)).sort();
    for (const n of old.slice(0, -5)) await fs.rm(path.join(snapDir(), n), { force: true });
  } catch {}
  await writeSettings({ lastRunVersion: v });
  if (s.backup?.enabled && s.backup?.dir) await backupNow();
}

// Ayar güncellemeleri sırayla uygulanır (arayüz ve zamanlayıcı aynı anda yazarsa biri kaybolmasın)
let settingsQueue = Promise.resolve();
// patch bir nesne ya da güncel ayarları alıp nesne döndüren fonksiyon olabilir.
function writeSettings(patch) {
  const run = settingsQueue.then(async () => {
    const cur = await readSettings();
    const next = { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) };
    await writeAtomic(settingsFile(), JSON.stringify(next, null, 2));
    mirrorSettings(next).catch(() => {});   // yedek başarısız olsa da ayar kaydı bozulmasın
    return next;
  });
  settingsQueue = run.catch(() => {});
  return run;
}

// Not adını güvenli bir dosya adına çevirir; klasör dışına çıkmayı engeller.
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
function safeName(name) {
  let n = String(name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/, '').trim().slice(0, 100);
  if (!n || RESERVED.test(n)) throw new Error('Geçersiz not adı');
  return n;
}
function notePath(name) {
  const p = path.resolve(notesDir(), safeName(name) + '.md');
  if (path.dirname(p) !== path.resolve(notesDir())) throw new Error('Geçersiz yol');
  return p;
}
async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }

// Güvenli yazma: önce geçici dosyaya yaz, sonra tek hamlede yerine koy.
// Böylece yazma sürerken yapılan bir okuma asla yarım/boş dosya görmez.
async function writeAtomic(p, data) {
  const tmp = `${p}.${process.pid}-${Math.random().toString(36).slice(2, 8)}.tmp`;
  await fs.writeFile(tmp, data, 'utf8');
  try {
    await fs.rename(tmp, p);
  } catch {
    // Dosya başka bir programda kilitliyse (ör. antivirüs) doğrudan yazmaya geri dön
    await fs.writeFile(p, data, 'utf8');
    await fs.rm(tmp, { force: true });
  }
}
async function uniqueName(base) {
  let name = safeName(base), i = 2;
  while (await exists(notePath(name))) name = `${safeName(base)} (${i++})`;
  return name;
}

// Pasif not işareti: dosyanın ilk satırı "<!-- silindi: 2026-10-05 08:30 -->"
const DELETED_RE = /^﻿?\s*<!--\s*silindi\b[^>]*-->/i;
const DELETED_LINE_RE = /^﻿?\s*<!--\s*silindi:?\s*([^>]*?)\s*-->[ \t]*\r?\n?/i;
const deletedMark = () => `<!-- silindi: ${new Date().toLocaleString('sv-SE').slice(0, 16)} -->`;

// Tüm notları (pasifler dahil) içerikleriyle oku
async function readAllNotes() {
  const files = (await fs.readdir(notesDir())).filter(f => f.toLowerCase().endsWith('.md'));
  return Promise.all(files.map(async f => {
    const p = path.join(notesDir(), f);
    const [stat, content] = await Promise.all([fs.stat(p), fs.readFile(p, 'utf8')]);
    return { name: f.slice(0, -3), mtime: stat.mtimeMs, content, deleted: DELETED_RE.test(content) };
  }));
}

// Arama sonucu için eşleşen satırdan kısa, sade bir parça çıkar
const lower = s => s.toLocaleLowerCase('tr');
function snippetFor(content, q) {
  for (const raw of content.split(/\r?\n/)) {
    if (!lower(raw).includes(q)) continue;
    const clean = raw
      .replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|\d+\.\s+|>\s*)/, '')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`~|]/g, '')
      .trim();
    const i = lower(clean).indexOf(q);
    if (i === -1) continue;
    if (clean.length <= 70) return clean;
    const start = Math.max(0, i - 25);
    return (start ? '…' : '') + clean.slice(start, start + 70) + (start + 70 < clean.length ? '…' : '');
  }
  return null;
}

const todayISO = () => new Date().toLocaleDateString('sv-SE');
const nowStamp = () => new Date().toLocaleString('sv-SE').slice(0, 16);

// ---------- Sabah bildirimi ----------
// todo.md'den bugün son tarihli ve gecikmiş (yapılmamış, silinmemiş) görevleri çıkarır.
function dueSummary(md) {
  const today = todayISO();
  const todayTasks = [], overdue = [];
  let catDeleted = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^#{2,6}\s/.test(line)) { catDeleted = /<!--\s*silindi/i.test(line); continue; }
    const t = line.match(/^\s*[-*+]\s+\[ \]\s+(.*)$/);
    if (!t || catDeleted || /<!--\s*silindi/i.test(t[1])) continue;
    const due = (t[1].match(/📅\s*(\d{4}-\d{2}-\d{2})/u) || [])[1];
    if (!due || due > today) continue;
    const text = t[1].replace(/\s*🔁[^📅<]*/u, '').replace(/\s*📅\s*\S+/u, '').replace(/\s*<!--.*?-->/g, '').replace(/[*_`~]/g, '').trim();
    (due === today ? todayTasks : overdue).push(text);
  }
  return { todayTasks, overdue };
}

async function sendDailySummary() {
  if (!Notification.isSupported()) return false;
  const { todayTasks, overdue } = dueSummary(await fs.readFile(todoFile(), 'utf8').catch(() => ''));
  let title, body;
  if (!todayTasks.length && !overdue.length) {
    title = 'Günaydın! Bugün için görev yok 🎉';
    body = 'Son tarihi bugün olan ya da geciken görevin bulunmuyor.';
  } else {
    title = [todayTasks.length && `Bugün ${todayTasks.length} görev`, overdue.length && `${overdue.length} geciken`].filter(Boolean).join(' · ');
    const lines = [...overdue.map(t => `⚠ ${t}`), ...todayTasks.map(t => `• ${t}`)];
    body = lines.slice(0, 5).join('\n') + (lines.length > 5 ? `\n…ve ${lines.length - 5} görev daha` : '');
  }
  const n = new Notification({ title, body, icon: ICON });
  n.on('click', () => { if (win) { win.show(); win.focus(); } });
  n.show();
  return true;
}

// ---------- Otomatik yedek ----------
// Veri klasörü her gün <seçilen klasör>/Panel yedekleri/YYYY-AA-GG altına kopyalanır; son 7 gün tutulur.
const BACKUP_KEEP = 7;
const backupRoot = dir => path.join(dir, 'Panel yedekleri');
async function runBackup() {
  const s = await readSettings();
  const dir = s.backup.dir;
  if (!dir) throw new Error('Yedek klasörü seçilmedi');
  const rel = path.relative(dataDir(), dir);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) throw new Error('Yedek klasörü veri klasörünün içinde olamaz');
  const root = backupRoot(dir);
  const dest = path.join(root, todayISO());
  await fs.mkdir(root, { recursive: true });
  await fs.cp(dataDir(), dest, { recursive: true, force: true });
  // Eski yedekleri temizle: sadece bu uygulamanın oluşturduğu tarih adlı klasörler
  const days = (await fs.readdir(root, { withFileTypes: true }))
    .filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
    .map(d => d.name).sort().reverse();
  for (const old of days.slice(BACKUP_KEEP)) await fs.rm(path.join(root, old), { recursive: true, force: true });
  return dest;
}
// İşlem öncesi yedek (scripts/backup.js tetikler: Panel.exe --backup-now=<ad>). Yedeği çalışan uygulama alır;
// çünkü geliştirme ortamındaki araçlar veri klasörünü bazen eski bir görüntüsüyle görebiliyor.
// Sonuç userData/backup-sonuc.json dosyasına yazılır (betik bunu bekler).
async function backupBeforeTask(label) {
  const result = { at: Date.now(), label, ok: false };
  try {
    const s = await readSettings();
    if (!s.backup.dir) throw new Error('Yedek klasörü seçilmedi');
    const d = new Date(), p2 = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}`;
    const root = path.join(backupRoot(s.backup.dir), 'islem-oncesi');
    const dest = path.join(root, label ? `${stamp}_${label}` : stamp);
    await fs.mkdir(root, { recursive: true });
    await fs.cp(dataDir(), dest, { recursive: true, force: true, preserveTimestamps: true });
    const old = (await fs.readdir(root, { withFileTypes: true }))
      .filter(e => e.isDirectory() && /^\d{4}-\d{2}-\d{2}_\d{4}/.test(e.name)).map(e => e.name).sort().reverse();
    for (const n of old.slice(30)) await fs.rm(path.join(root, n), { recursive: true, force: true });
    const st = await readJson(path.join(dest, 'settings.json'));
    Object.assign(result, { ok: true, dest, city: st?.city?.name || null, lists: (st?.musicLists || []).length, files: (await fs.readdir(dest)).length });
  } catch (err) {
    result.error = String(err.message || err);
  }
  await writeAtomic(path.join(app.getPath('userData'), 'backup-sonuc.json'), JSON.stringify(result, null, 2)).catch(() => {});
  return result;
}
async function backupNow() {
  try {
    await runBackup();
    await writeSettings(c => ({ backup: { ...c.backup, lastAt: nowStamp(), lastDate: todayISO(), error: null } }));
  } catch (err) {
    await writeSettings(c => ({ backup: { ...c.backup, error: err.message || String(err) } }));
  }
  return readSettings();
}

// Her dakika: bildirim saati geldiyse günün özetini gönder; günün yedeği alınmadıysa al.
// (Bilgisayar o saatte kapalıysa açıldığında gönderilir/alınır.)
async function checkSchedules() {
  const s = await readSettings();
  const today = todayISO();
  const hm = new Date().toTimeString().slice(0, 5);
  if (s.notify.enabled && s.notify.lastDate !== today && hm >= s.notify.time) {
    await writeSettings(c => ({ notify: { ...c.notify, lastDate: today } }));
    await sendDailySummary();
  }
  if (s.backup.enabled && s.backup.dir && s.backup.lastDate !== today) await backupNow();
}

const IMAGE_TYPES ={ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp' };

// ---------- Sesli asistan (Gemini API) ----------
// Arayüz ses kaydını + o anki görev listesini (metin) gönderir; burada tek bir Gemini isteğine
// dönüştürülür. Ses tanıma + anlama + muhakeme Gemini'de olur, yerel bir konuşma tanımaya gerek yoktur.
// Cevap sesli okuma (TTS) tamamen yerelde/bedava kalır (bkz. src/js/assistant.js → speechSynthesis).
const ASSISTANT_SYSTEM_PROMPT = `Senin adın SPARK. "Panel" adlı kişisel masaüstü uygulamasının sesli ve yazılı asistanısın. Kullanıcı Türkçe konuşuyor (ses) ya da yazıyor (metin).
Sıcak, samimi ve KISA konuş. speech alanı en fazla 1-2 kısa cümle (yaklaşık 20 kelime) olsun; doğal konuşma diliyle yaz (madde işareti, emoji, kısaltma yok; sayıları ve dereceleri okunuşuyla yaz). Çok sayıda işlem yaptıysan tek tek sayma: "Üç görev ekledim, biri de tamamlandı." gibi özetle.
Her istekte sana bağlam metni veriliyor: şu anki tarih/saat, hava durumu, görev listesi ve önceki konuşma. Önceki konuşmaya göre devam et ("onu da ekle", "bir de yarına al" gibi atıfları çöz). Görevlerin başında [t12] gibi bir kimlik var; görevi değiştirirken task_id olarak yalnızca bu kimliklerden birini kullan, asla uydurma.

Yanıtını SADECE verilen JSON şemasına uygun, Türkçe olarak ver. type değerleri:
- "actions": kullanıcı görevler üzerinde bir ya da BİRDEN FAZLA işlem istiyor. Her işlemi actions dizisine ayrı bir öğe olarak yaz. Bir mesajda istediği kadar işlem olabilir ("yarın rapor yaz, cuma sunum hazırla ve süt almayı tamamla" → 3 öğe).
  Öğe alanları (action zorunlu):
  · action "add_task": yeni görev. task_text: kısa net görev metni (tarih/kategori/tekrar ifadelerini ve görevin kendisi olmayan "ekle", "not et", "görev olarak ekle" gibi ekleme komutunu metinden çıkar; saat bilgisi varsa metinde bırak, ör. "saat 14:00 dişçi randevusu"). due: varsa YYYY-AA-GG. rec: varsa tekrar kuralı ("her gün" / "hafta içi" / "her hafta" / "her N hafta" / "her ay" / "her yıl"). category: YALNIZCA kullanıcı kategoriyi açıkça söylediyse (ya da önceki konuşmada söylemişse) doldur — mevcut kategorilerden biri ya da söylediği yeni isim; söylemediyse boş bırak, tahmin etme; kullanıcı hepsi için tek kategori söylediyse her öğeye onu yaz.
  · action "complete_task": task_id'li görevi yapıldı işaretle.
  · action "reopen_task": yapılmış görevi tekrar yapılmadı yap.
  · action "delete_task": görevi sil (Silinenler'den geri getirilebilir).
  · action "update_task": task_id'li görevin new_text (yeni metin), due (YYYY-AA-GG; kaldırmak için "yok") ya da rec (kaldırmak için "yok") alanını değiştir; değişmeyeni boş bırak.
  Mevcut bir görevi belirlerken söyleneni en iyi karşılayan TEK görevi seç. Emin olamıyorsan ya da birden fazla görev eşit uyuyorsa o işlemi yazma; type "answer" ile hangisini kastettiğini kısaca sor.
  Kategori: kullanıcı yeni görev için kategori söylemediyse (ve önceki konuşmada belirtmediyse) görevi kendin bir kategoriye KOYMA; yalnızca tek bir aktif kategori varsa onu kullan, aksi halde type "need_category" ile sor.
- Bilgisayarda işlem (actions içinde, görev işlemleriyle aynı mesajda da olabilir):
  · action "open_url": kullanıcı bir web sayfası açmak/aramak istiyor ("google'ı aç", "github.com'u aç", "yarınki maçı google'da ara"). url: tam adres (https://…). Bilinen sitelerin ana sayfasını kullan; arama istenirse https://www.google.com/search?q=<kodlanmış arama> kullan.
  · action "play_music": müzik çal (kullanıcı YouTube Music kullanıyor). Önce bağlamdaki "Müzik listelerim" listesine bak: istek bu listelerden birine uyuyorsa (ör. "chill bir şeyler aç" → adı chill/rahat/dinlendirici olan) music_list alanına o listenin adını AYNEN yaz. Uymuyorsa: belirli bir şarkı/sanatçı için music_kind "song" ve music_query "sanatçı şarkı adı"; tür/ruh hali/genel istek için music_kind "playlist" ve music_query kısa bir arama ("chill lofi", "türkçe rap").
  · action "media_control": çalan müziği yönet. media_key: play_pause (durdur/duraklat/devam et), next (sonraki şarkı), previous (önceki şarkı), stop, volume_up (sesi aç), volume_down (sesi kıs), mute (sesi kapat/aç).
- "need_category": eklenecek görev(ler) var ama kategori söylenmedi, bağlamdaki "Önceki istek" notu da yok ve hangi kategoriye gideceği belli değil. Görevleri yine actions içine add_task olarak yaz (category boş) — actions boş KALMAMALI, kullanıcının istediği her görev orada olmalı.
  Önceki konuşmada kullanıcı görev eklemek istediyse ve SPARK kategori sorduysa, kullanıcı şimdi sadece kategori söylese bile ("Kişisel", "ikisi de iş olsun") önceki mesajlardaki TÜM görevleri o kategoriyle actions'a add_task olarak yaz. speech: "Hangi kategoriye ekleyeyim?" gibi kısa bir soru.
- "answer": soru ya da sohbet (görev değişikliği yok). Bağlamdaki görev listesi, hava durumu, tarih/saat ve önceki konuşmaya bakarak cevap ver. Belirli bir güne bağlı bir soruysa highlight_date alanına o tarihi (YYYY-AA-GG) yaz, değilse boş bırak. Hava durumu bilgisi bağlamda yoksa şehrin Ayarlar'dan seçilmediğini söyle.

heard alanına kullanıcının söylediğini/yazdığını anladığın haliyle yaz.
Anlayamadığın bir ses gelirse type "answer" ile nazikçe tekrar etmesini iste.`;
const ASSISTANT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['actions', 'need_category', 'answer'] },
    heard: { type: 'string' },
    speech: { type: 'string' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add_task', 'complete_task', 'reopen_task', 'delete_task', 'update_task', 'open_url', 'play_music', 'media_control'] },
          url: { type: 'string' },
          music_query: { type: 'string' },
          music_kind: { type: 'string', enum: ['song', 'playlist'] },
          music_list: { type: 'string' },
          media_key: { type: 'string', enum: ['play_pause', 'next', 'previous', 'stop', 'volume_up', 'volume_down', 'mute'] },
          task_text: { type: 'string' },
          task_id: { type: 'string' },
          new_text: { type: 'string' },
          due: { type: 'string' },
          rec: { type: 'string' },
          category: { type: 'string' },
        },
        required: ['action'],
      },
    },
    highlight_date: { type: 'string' },
  },
  required: ['type', 'speech'],
};
// Gemini isteği: takılırsa belirli süre sonra vazgeçilir (arayüz sonsuza kadar "düşünüyor"da kalmasın)
async function geminiFetch(url, body, ms) {
  try {
    return await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
  } catch (e) {
    if (e?.name === 'TimeoutError') throw new Error('Gemini zamanında yanıt vermedi, tekrar dene.');
    throw e;
  }
}
// Bu hatalarda aynı istek başka bir modelle denenir: yoğun talep/geçici hata (500/503/504), dakikalık kota (429),
// model kimliği yok/desteklenmiyor (404, 400). Anahtar hataları (401/403) denenmez, doğrudan söylenir.
const FALLBACK_STATUS = new Set([429, 500, 503, 504, 404]);
const isOverloaded = (status, msg) => FALLBACK_STATUS.has(status) || /high demand|overloaded|unavailable|try again later|not found|not supported/i.test(msg || '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function askAssistant(audioBytes, mimeType, contextText) {
  const s = await readSettings();
  if (!s.geminiApiKey) throw new Error('Gemini API anahtarı girilmemiş (Ayarlar → Sesli asistan).');
  if (!s.geminiModel) throw new Error('Gemini model adı girilmemiş (Ayarlar → Sesli asistan).');
  // audioBytes boşsa (ör. Ayarlar'daki bağlantı testi) sadece metinle istek atılır
  const parts = [{ text: contextText }];
  if (audioBytes) parts.push({ inlineData: { mimeType, data: Buffer.from(audioBytes).toString('base64') } });
  const body = {
    systemInstruction: { parts: [{ text: ASSISTANT_SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: ASSISTANT_RESPONSE_SCHEMA },
  };
  const models = [s.geminiModel, ...String(s.geminiFallbackModels || '').split(',').map(x => x.trim()).filter(Boolean)]
    .filter((x, i, arr) => arr.indexOf(x) === i);
  let lastErr = null, lastWhy = '';
  for (let mi = 0; mi < models.length; mi++) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(models[mi])}:generateContent?key=${encodeURIComponent(s.geminiApiKey)}`;
    // Aynı modelde: ağ/zaman aşımı hatası ya da bozuk JSON'da bir kez daha; yoğunlukta hemen sıradaki modele geç
    for (let attempt = 0; attempt < 2; attempt++) {
      let res;
      try { res = await geminiFetch(url, body, 20000); }
      catch (e) { lastErr = e; break; }   // zaman aşımı/bağlantı: sıradaki modeli dene
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        let msg = `Gemini isteği başarısız (${res.status})`;
        try { msg = JSON.parse(errText)?.error?.message || msg; } catch {}
        lastErr = new Error(msg);
        if (isOverloaded(res.status, msg)) break;   // sıradaki modele geç
        throw lastErr;                               // anahtar/istek hatası: yedek model çözmez
      }
      const data = await res.json();
      const cand = data?.candidates?.[0];
      const text = cand?.content?.parts?.map(x => x.text || '').join('');
      let out = null;
      if (text) {
        try { out = JSON.parse(text); } catch {
          // Çevresinde fazladan metin/kod bloğu varsa asıl JSON'u ayıkla
          const obj = text.match(/\{[\s\S]*\}/)?.[0];
          if (obj) { try { out = JSON.parse(obj); } catch {} }
        }
      }
      if (out) { if (mi > 0) console.warn(`SPARK: yanıt yedek modelden geldi (${models[mi]})`); return out; }
      lastWhy = text ? `çözümlenemedi (${cand?.finishReason || 'bilinmiyor'})` : 'boş yanıt';
      lastErr = null;
    }
    if (mi < models.length - 1) await sleep(250);
  }
  if (lastErr) throw new Error(`${lastErr.message}${models.length > 1 ? ` (${models.length} model denendi)` : ''}`);
  throw new Error(`Gemini yanıtı ${lastWhy}; ses anlaşılamamış olabilir, tekrar dene.`);
}

// ---------- Bilgisayarda işlemler: tarayıcı ve YouTube Music ----------
// Chrome ile kurulmuş "YouTube Music" uygulamasını (PWA) Başlat menüsündeki kısayolundan bulur.
function findYtmApp() {
  try {
    const dir = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Chrome Uygulamaları');
    for (const f of fsSync.readdirSync(dir)) {
      if (!f.endsWith('.lnk') || !/youtube music/i.test(f)) continue;
      const l = shell.readShortcutLink(path.join(dir, f));
      const appId = /--app-id=([a-p]{32})/.exec(l.args || '')?.[1];
      if (!appId) continue;
      const profile = /--profile-directory=("[^"]+"|\S+)/.exec(l.args)?.[1]?.replace(/"/g, '') || 'Default';
      return { exe: l.target, appId, profile };
    }
  } catch {}
  return null;
}
// scripts/ytm.ps1'i çalıştırır (paketliyken asar içinden okunup geçici dosyaya yazılır)
async function runYtmScript(args) {
  const script = path.join(app.getPath('userData'), 'ytm.ps1');
  await fs.writeFile(script, await fs.readFile(path.join(__dirname, 'scripts', 'ytm.ps1')));
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
      { timeout: 40000, windowsHide: true }, (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || err.message || '').toString().trim().split('\n')[0]));
        resolve(String(stdout).trim().split('\n').pop().trim());
      });
  });
}
// YouTube Music'in belgelenmemiş arama uç noktası (anahtar gerektirmez). Bozulursa arama sayfası açılır.
async function ytmSearch(query, kind) {
  const params = kind === 'playlist' ? 'EgeKAQQoAEABagwQDhAKEAMQBBAJEAU%3D' : 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D';
  const body = { context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20241001.01.00', hl: 'tr', gl: 'TR' } }, query, params };
  const res = await fetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://music.youtube.com' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error('YouTube Music araması başarısız (' + res.status + ')');
  const data = await res.json();
  let found = null;
  (function walk(o) {
    if (found || !o || typeof o !== 'object') return;
    const r = o.musicResponsiveListItemRenderer;
    if (r) {
      const id = kind === 'playlist'
        ? r.navigationEndpoint?.browseEndpoint?.browseId?.replace(/^VL/, '')
        : r.playlistItemData?.videoId || r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
      if (id) { found = id; return; }
    }
    for (const k in o) walk(o[k]);
  })(data);
  return found;
}
const trLower = s => String(s || '').toLocaleLowerCase('tr').trim();
// Adresi YouTube Music uygulamasında açar; uygulama bulunamazsa varsayılan tarayıcıda yeni sekmede açar.
async function openInYtm(url, shuffle) {
  const y = findYtmApp();
  if (!y) { await shell.openExternal(url); return 'YouTube Music uygulaması bulunamadı, tarayıcıda açtım.'; }
  const out = await runYtmScript(['-Mode', 'open', '-Url', url, '-Exe', y.exe, '-ProfileDir', y.profile, '-AppId', y.appId, ...(shuffle ? ['-Shuffle'] : [])]);
  if (out === 'pencere-yok') return 'YouTube Music penceresi açılamadı.';
  return null;   // başarılı
}
// Arayüzden gelen işlem isteği: { type: 'open_url'|'play_music'|'media_control', ... } → { ok, message? }
async function systemAction(a) {
  try {
    if (a.type === 'ytm_status') return { ok: !!findYtmApp() };
    if (a.type === 'open_url') {
      const u = new URL(String(a.url || ''));
      if (!/^https?:$/.test(u.protocol)) throw new Error('Yalnızca http/https adresleri açılabilir.');
      await shell.openExternal(u.href);   // varsayılan tarayıcıda yeni sekme; ayrı uygulama penceresi açılmaz
      return { ok: true };
    }
    if (a.type === 'media_control') {
      const out = await runYtmScript(['-Mode', 'key', '-Key', String(a.key || '')]);
      return out === 'ok' ? { ok: true } : { ok: false, message: out };
    }
    if (a.type === 'play_music') {
      const s = await readSettings();
      let url, shuffle = false;
      const lists = Array.isArray(s.musicLists) ? s.musicLists : [];
      const want = trLower(a.list);
      const hit = want && (lists.find(l => trLower(l.name) === want) || lists.find(l => trLower(l.name).includes(want) || want.includes(trLower(l.name))));
      if (hit) {
        url = `https://music.youtube.com/playlist?list=${encodeURIComponent(hit.id)}`;
        shuffle = true;
      } else if (a.query) {
        const kind = a.kind === 'playlist' ? 'playlist' : 'song';
        const id = await ytmSearch(String(a.query), kind).catch(() => null);
        if (id && kind === 'playlist') { url = `https://music.youtube.com/playlist?list=${encodeURIComponent(id)}`; shuffle = true; }
        else if (id) url = `https://music.youtube.com/watch?v=${encodeURIComponent(id)}&list=RDAMVM${encodeURIComponent(id)}`;
        else url = `https://music.youtube.com/search?q=${encodeURIComponent(String(a.query))}`;   // sonuç/uç nokta yoksa arama sayfası
      } else {
        return { ok: false, message: 'Ne çalacağımı anlayamadım.' };
      }
      const msg = await openInYtm(url, shuffle);
      return msg ? { ok: false, message: msg } : { ok: true };
    }
    return { ok: false, message: 'Bilinmeyen işlem.' };
  } catch (err) {
    return { ok: false, message: String(err?.message || err).slice(0, 160) };
  }
}

// ---------- SPARK'ın sesi (Gemini TTS) ----------
// Metni Gemini'nin hazır seslerinden biriyle sese çevirir; ham PCM (16 bit, tek kanal) döner.
// Ücretsiz TTS kotası model başına günde ~10 istek; bu yüzden ayardaki modeller sırayla denenir.
// Günlük kotası dolan model o gün için atlanır (dakikalık sınır ise sadece o istekte atlanır).
// Hepsi başarısız olursa hata fırlatılır, arayüz yerel Windows sesine (Tolga) döner.
const ttsDayExhausted = new Map();   // model → kotasının dolduğu gün
async function geminiTts(text, voiceOverride) {
  const s = await readSettings();
  if (!s.geminiApiKey) throw new Error('Gemini API anahtarı girilmemiş.');
  const models = String(s.ttsModels || DEFAULT_SETTINGS.ttsModels).split(',').map(m => m.trim()).filter(Boolean);
  const today = todayISO();
  let lastErr = new Error('Ayarlarda kullanılabilir bir TTS modeli yok.');
  for (const model of models) {
    if (ttsDayExhausted.get(model) === today) continue;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(s.geminiApiKey)}`;
    const body = {
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceOverride || s.ttsVoice || 'Kore' } } },
      },
    };
    const res = await geminiFetch(url, body, 30000);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      if (res.status === 429 && /PerDay/i.test(errText)) ttsDayExhausted.set(model, today);
      let msg = `${model}: istek başarısız (${res.status})`;
      try { msg = `${model}: ${JSON.parse(errText)?.error?.message || res.status}`; } catch {}
      lastErr = new Error(msg);
      continue;
    }
    const data = await res.json();
    const part = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);
    if (!part) { lastErr = new Error(`${model}: ses dönmedi`); continue; }
    const rate = Number((part.inlineData.mimeType || '').match(/rate=(\d+)/)?.[1]) || 24000;
    return { pcm: Buffer.from(part.inlineData.data, 'base64'), sampleRate: rate, model };
  }
  throw lastErr;
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('todos:read', () => fs.readFile(todoFile(), 'utf8'));
  ipcMain.handle('todos:write', (_e, content) => writeAtomic(todoFile(), String(content)));
  ipcMain.handle('todos:writeShared', (_e, content) => writeAtomic(sharedCopyFile(), String(content)));

  // Pasif (silinmiş) notlar listede gösterilmez; dosyaları yerinde durur.
  ipcMain.handle('notes:list', async () =>
    (await readAllNotes()).filter(n => !n.deleted).map(({ name, mtime }) => ({ name, mtime })));

  // Tam metin arama: başlıkta veya içerikte geçen notlar + eşleşen satırdan bir parça
  ipcMain.handle('notes:search', async (_e, query) => {
    const q = lower(String(query || '').trim());
    if (!q) return [];
    return (await readAllNotes())
      .filter(n => !n.deleted)
      .map(n => ({ name: n.name, nameHit: lower(n.name).includes(q), snippet: snippetFor(n.content, q) }))
      .filter(n => n.nameHit || n.snippet);
  });

  ipcMain.handle('notes:listDeleted', async () =>
    (await readAllNotes()).filter(n => n.deleted).map(n => ({
      name: n.name,
      deletedAt: (n.content.match(DELETED_LINE_RE) || [])[1] || '',
    })));
  ipcMain.handle('notes:restore', async (_e, name) => {
    const p = notePath(name);
    const content = await fs.readFile(p, 'utf8');
    await writeAtomic(p, content.replace(DELETED_LINE_RE, ''));
  });

  // Yapıştırılan / sürüklenen resim → notes/resimler/ altına kaydedilir, nottaki göreli yol döner
  ipcMain.handle('notes:saveImage', async (_e, bytes, mime) => {
    const ext = IMAGE_TYPES[mime];
    if (!ext) throw new Error('Desteklenmeyen resim türü');
    const buf = Buffer.from(bytes);
    if (buf.length > 25 * 1024 * 1024) throw new Error('Resim çok büyük');
    await fs.mkdir(imagesDir(), { recursive: true });
    const stamp = new Date().toLocaleString('sv-SE').replace(/[-: ]/g, '').slice(0, 14);
    const file = `${stamp}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
    await fs.writeFile(path.join(imagesDir(), file), buf);
    return `resimler/${file}`;
  });
  ipcMain.handle('notes:read', (_e, name) => fs.readFile(notePath(name), 'utf8'));
  ipcMain.handle('notes:write', (_e, name, content) => writeAtomic(notePath(name), String(content)));
  ipcMain.handle('notes:create', async (_e, base) => {
    const name = await uniqueName(base || 'Yeni not');
    await fs.writeFile(notePath(name), `# ${name}\n\n`, 'utf8');
    return name;
  });
  ipcMain.handle('notes:rename', async (_e, from, to) => {
    if (safeName(from) === safeName(to)) return safeName(from);
    const name = await uniqueName(to);
    await fs.rename(notePath(from), notePath(name));
    return name;
  });
  // Silme = pasif yapma: dosyanın en başına bir işaret satırı eklenir, dosya yerinde kalır.
  // Geri getirmek için dosyayı açıp ilk satırdaki <!-- silindi: ... --> işaretini silmek yeterli.
  ipcMain.handle('notes:delete', async (_e, name) => {
    const p = notePath(name);
    const content = await fs.readFile(p, 'utf8');
    if (!DELETED_RE.test(content)) await writeAtomic(p, `${deletedMark()}\n${content}`);
  });

  // notesUrl: notlardaki göreli resim yollarının (resimler/…) çözüleceği klasör
  const withRuntime = s => ({
    ...s, isPackaged: app.isPackaged, shortcut: SHORTCUT, voiceShortcut: VOICE_SHORTCUT,
    cloudEmulator: process.env.PANEL_FIREBASE_EMULATOR === '1',   // geliştirme: Firebase emülatörüne bağlan
    notesUrl: pathToFileURL(notesDir()).href + '/',
  });
  ipcMain.handle('settings:get', async () => withRuntime(await readSettings()));
  ipcMain.handle('settings:set', async (_e, patch) => {
    const s = await writeSettings(patch);
    if ('autostart' in patch) applyAutostart(s.autostart);
    return withRuntime(s);
  });
  ipcMain.handle('app:openDataDir', () => shell.openPath(dataDir()));

  // Bildirim ve yedek ayarları ana süreçte birleştirilir (zamanlayıcının yazdıklarıyla çakışmasın)
  ipcMain.handle('notify:config', async (_e, patch) => {
    return withRuntime(await writeSettings(c => ({ notify: { ...c.notify, ...patch } })));
  });
  ipcMain.handle('notify:test', () => sendDailySummary());
  ipcMain.handle('backup:config', async (_e, patch) => {
    const next = await writeSettings(c => ({ backup: { ...c.backup, ...patch } }));
    if (next.backup.enabled && next.backup.dir && next.backup.lastDate !== todayISO()) return withRuntime(await backupNow());
    return withRuntime(next);
  });
  ipcMain.handle('backup:choose', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Yedek klasörünü seç', properties: ['openDirectory', 'createDirectory'] });
    const s = await readSettings();
    if (r.canceled || !r.filePaths[0]) return withRuntime(s);
    const next = await writeSettings(c => ({ backup: { ...c.backup, dir: r.filePaths[0], enabled: true, lastDate: null } }));
    return withRuntime(next.backup.enabled ? await backupNow() : next);
  });
  ipcMain.handle('backup:now', async () => withRuntime(await backupNow()));
  ipcMain.handle('backup:open', async () => {
    const s = await readSettings();
    if (s.backup.dir) shell.openPath(await fs.mkdir(backupRoot(s.backup.dir), { recursive: true }).then(() => backupRoot(s.backup.dir)));
  });
  ipcMain.handle('app:openExternal', (_e, url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  ipcMain.handle('assistant:ask', (_e, audioBytes, mimeType, contextText) => askAssistant(audioBytes, mimeType, contextText));
  ipcMain.handle('assistant:system', (_e, act) => systemAction(act || {}));
  ipcMain.handle('assistant:speak', (_e, text, voice) => geminiTts(String(text || '').slice(0, 1500), voice));
  // Ayarlar'daki "Bağlantıyı dene": ses göndermeden anahtar/model doğru mu diye küçük bir metin isteği
  ipcMain.handle('assistant:test', () => askAssistant(null, null,
    'Bu bir bağlantı testidir, gerçek bir kullanıcı isteği değil. type "answer", speech alanına sadece "Bağlantı başarılı." yaz.'));

  // Tema değişince üst çubuğun (pencere denetim düğmelerinin arkasındaki alan) rengini güncelle
  ipcMain.handle('app:titleBar', async (_e, color, symbolColor) => {
    const ok = c => typeof c === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(c.trim());
    if (!ok(color) || !ok(symbolColor) || !win || win.isDestroyed()) return;
    color = color.trim(); symbolColor = symbolColor.trim();
    if (typeof win.setTitleBarOverlay === 'function') win.setTitleBarOverlay({ color, symbolColor, height: TITLEBAR_H });
    win.setBackgroundColor(color);
    await writeSettings({ titleBar: { color, symbolColor } });
  });
}

function applyAutostart(enabled) {
  // Geliştirme modunda (npm start) electron.exe kaydedilmesin diye sadece paketlenmiş sürümde çalışır.
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: !!enabled, args: ['--hidden'] });
}

// ---------- Pencere & tepsi ----------
function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && win.isFocused()) win.hide();
  else { win.show(); win.focus(); }
}

function createWindow(settings, startHidden) {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const tb = settings.titleBar;
  win = new BrowserWindow({
    width: Math.min(1360, Math.round(sw * 0.9)),
    height: Math.min(920, Math.round(sh * 0.92)),
    minWidth: 860,
    minHeight: 560,
    show: false,
    backgroundColor: tb.color,
    icon: ICON_ICO,
    title: 'Panel',
    // Windows'un kendi (siyah/beyaz) başlık çubuğu yok: üst çubuğu arayüz çizer ve tema rengini alır.
    // Küçült / büyüt / kapat düğmeleri sağ üstte kalır, renkleri temaya uyar.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: tb.color, symbolColor: tb.symbolColor, height: TITLEBAR_H },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();   // varsayılan (İngilizce) menü çubuğu hiç gösterilmesin (Alt tuşuyla bile)
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => { if (!startHidden) win.show(); });
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); } });
  // Notlardaki bağlantılar uygulama içinde değil, varsayılan tarayıcıda açılsın.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });
}

function createTray() {
  // ICO içindeki boyutlardan Windows ekran ölçeğine uygun olanı seçer
  tray = new Tray(nativeImage.createFromPath(ICON_ICO));
  tray.setToolTip(`Panel (${SHORTCUT.replace('Control', 'Ctrl')})`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Paneli göster', click: () => { win.show(); win.focus(); } },
    { label: 'Veri klasörünü aç', click: () => shell.openPath(dataDir()) },
    { type: 'separator' },
    { label: 'Çıkış', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', toggleWindow);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const arg = argv.find(a => a.startsWith('--backup-now'));
    if (arg) { backupBeforeTask((arg.split('=')[1] || '').replace(/[^\w.-]+/g, '-')); return; }   // pencereyi öne getirme
    if (win) { win.show(); win.focus(); }
  });

  app.whenReady().then(async () => {
    await ensureData();
    await recoverSettings().catch(() => {});
    registerIpc();
    // Sesli asistan mikrofon izni ister; Electron varsayılan olarak reddeder, burada izin veriyoruz
    // (Windows kendi "Mikrofona erişime izin ver" sorusunu ayrıca gösterir, bu ondan bağımsız).
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'media'));
    ensureStartMenuShortcut();
    await onVersionChange().catch(() => {});
    const settings = await readSettings();
    applyAutostart(settings.autostart);
    createWindow(settings, process.argv.includes('--hidden'));
    createTray();
    globalShortcut.register(SHORTCUT, toggleWindow);
    // Pencere gizliyken de sesli asistanı açabilmek için: önce göster, sonra arayüze haber ver.
    globalShortcut.register(VOICE_SHORTCUT, () => {
      if (!win) return;
      win.show(); win.focus();
      win.webContents.send('assistant:trigger');
    });
    // Bildirim/yedek zamanlayıcısı: açılıştan kısa süre sonra, sonra dakikada bir
    setTimeout(() => checkSchedules().catch(() => {}), 8000);
    setInterval(() => checkSchedules().catch(() => {}), 60 * 1000);
  });

  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  // Pencere gizlenince uygulama kapanmasın; tepside yaşamaya devam etsin.
  app.on('window-all-closed', () => {});
}
