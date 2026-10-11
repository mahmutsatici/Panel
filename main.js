const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, shell, nativeImage, screen, Notification, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { pathToFileURL } = require('url');

// Yerleşik arayüz parçaları Türkçe olsun
app.commandLine.appendSwitch('lang', 'tr');
// Windows bildirimlerinde uygulama adı/simgesi doğru görünsün (package.json → build.appId ile aynı)
app.setAppUserModelId('local.masaustu.panel');

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
  // SPARK'ın sesi (Gemini TTS). ttsModels virgülle ayrılmış listedir ve sırayla denenir: birinin günlük
  // ücretsiz kotası dolarsa sıradakine geçilir; hepsi doluysa arayüz yerel Windows sesine (Tolga) döner.
  ttsEnabled: true, ttsVoice: 'Kore',
  // Konuşma bitince (bu kadar ms sessizlikten sonra) kayıt kendiliğinden gönderilir; 0 = kapalı, düğmeyle bitirilir
  sparkSilenceMs: 1500, ttsModels: 'gemini-2.5-flash-preview-tts',
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
  try { saved = JSON.parse(await fs.readFile(settingsFile(), 'utf8')); } catch {}
  return {
    ...DEFAULT_SETTINGS, ...saved,
    titleBar: { ...DEFAULT_SETTINGS.titleBar, ...(saved.titleBar || {}) },
    notify: { ...DEFAULT_SETTINGS.notify, ...(saved.notify || {}) },
    backup: { ...DEFAULT_SETTINGS.backup, ...(saved.backup || {}) },
  };
}

// Ayar güncellemeleri sırayla uygulanır (arayüz ve zamanlayıcı aynı anda yazarsa biri kaybolmasın)
let settingsQueue = Promise.resolve();
// patch bir nesne ya da güncel ayarları alıp nesne döndüren fonksiyon olabilir.
function writeSettings(patch) {
  const run = settingsQueue.then(async () => {
    const cur = await readSettings();
    const next = { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) };
    await writeAtomic(settingsFile(), JSON.stringify(next, null, 2));
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
const ASSISTANT_SYSTEM_PROMPT = `Senin adın SPARK. "Panel" adlı kişisel masaüstü uygulamasının sesli asistanısın. Kullanıcı Türkçe konuşuyor, sesini dinliyorsun.
Sıcak, samimi ve KISA konuş. speech alanı Gemini sesiyle okunuyor ve süre uzunluğa göre artıyor: en fazla 1-2 kısa cümle (yaklaşık 20 kelime), doğal konuşma diliyle yaz (madde işareti, emoji, kısaltma yok; sayıları ve dereceleri okunuşuyla yaz).
Her istekte sana bağlam metni veriliyor: şu anki tarih/saat, hava durumu ve görev listesi. Görevlerin başında [t12] gibi bir kimlik var; görevi değiştirirken task_id olarak yalnızca bu kimliklerden birini kullan, asla uydurma.

Yanıtını SADECE verilen JSON şemasına uygun, Türkçe olarak ver. type değerleri:
- "add_task": yeni görev ekleme isteği VE kategori ya söylendi ya da context'teki "Önceki istek" notundan belli.
  task_text: görevin kısa net metni (tarih/kategori ifadelerini metinden çıkar). due: varsa YYYY-AA-GG. rec: varsa tekrar kuralı ("her gün" / "hafta içi" / "her hafta" / "her N hafta" / "her ay" / "her yıl"). category: mevcut kategorilerden biri ya da kullanıcının söylediği yeni bir isim.
- "need_category": görev ekleme isteği ama kategori söylenmedi ve "Önceki istek" notu da yok. task_text/due/rec'i yine doldur. speech: "Hangi kategoriye ekleyeyim?" gibi kısa bir soru.
- "complete_task": var olan bir görevi yapıldı/tamamlandı işaretle. task_id zorunlu.
- "reopen_task": yapılmış bir görevi tekrar yapılmadı yap. task_id zorunlu.
- "delete_task": görevi sil (Silinenler'den geri getirilebilir). task_id zorunlu.
- "update_task": var olan bir görevin metnini, tarihini ya da tekrarını değiştir. task_id zorunlu. Değişenleri doldur: new_text (yeni metin), due (YYYY-AA-GG; tarihi kaldırmak için "yok"), rec (tekrar kuralı; kaldırmak için "yok"). Değişmeyeni boş bırak.
  Görevi belirlerken kullanıcının söylediği ifadeye en çok uyan TEK görevi seç. Birden fazla görev eşit derecede uyuyorsa ya da hiçbiri uymuyorsa değişiklik yapma: type "answer" ile hangisini kastettiğini kısaca sor.
- "answer": soru ya da sohbet (görev değişikliği değil). Bağlamdaki görev listesi, hava durumu ve tarih/saate bakarak cevap ver. Belirli bir güne bağlı bir soruysa highlight_date alanına o tarihi (YYYY-AA-GG) yaz, değilse boş bırak. Hava durumu bilgisi bağlamda yoksa şehrin Ayarlar'dan seçilmediğini söyle.

heard alanına kullanıcının söylediğini anladığın haliyle yaz.
Anlayamadığın bir ses gelirse type "answer" ile nazikçe tekrar etmesini iste.`;
const ASSISTANT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['add_task', 'need_category', 'complete_task', 'reopen_task', 'delete_task', 'update_task', 'answer'] },
    heard: { type: 'string' },
    speech: { type: 'string' },
    task_text: { type: 'string' },
    task_id: { type: 'string' },
    new_text: { type: 'string' },
    due: { type: 'string' },
    rec: { type: 'string' },
    category: { type: 'string' },
    highlight_date: { type: 'string' },
  },
  required: ['type', 'speech'],
};
async function askAssistant(audioBytes, mimeType, contextText) {
  const s = await readSettings();
  if (!s.geminiApiKey) throw new Error('Gemini API anahtarı girilmemiş (Ayarlar → Sesli asistan).');
  if (!s.geminiModel) throw new Error('Gemini model adı girilmemiş (Ayarlar → Sesli asistan).');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.geminiModel)}:generateContent?key=${encodeURIComponent(s.geminiApiKey)}`;
  // audioBytes boşsa (ör. Ayarlar'daki bağlantı testi) sadece metinle istek atılır
  const parts = [{ text: contextText }];
  if (audioBytes) parts.push({ inlineData: { mimeType, data: Buffer.from(audioBytes).toString('base64') } });
  const body = {
    systemInstruction: { parts: [{ text: ASSISTANT_SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: ASSISTANT_RESPONSE_SCHEMA },
  };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    let msg = `Gemini isteği başarısız (${res.status})`;
    try { msg = JSON.parse(errText)?.error?.message || msg; } catch {}
    throw new Error(msg);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini boş yanıt döndürdü (ses anlaşılamamış olabilir).');
  try { return JSON.parse(text); } catch { throw new Error('Gemini yanıtı çözümlenemedi.'); }
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
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
  app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });

  app.whenReady().then(async () => {
    await ensureData();
    registerIpc();
    // Sesli asistan mikrofon izni ister; Electron varsayılan olarak reddeder, burada izin veriyoruz
    // (Windows kendi "Mikrofona erişime izin ver" sorusunu ayrıca gösterir, bu ondan bağımsız).
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'media'));
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
