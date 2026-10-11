// İşlem öncesi yedek: kullanıcının veri klasörünü (todo.md, notlar, settings.json) seçili yedekleme
// klasörüne kopyalar. Geliştirme sırasında veriye dokunabilecek her işten önce çalıştırılır
// (npm run backup; npm run dist zaten kendiliğinden çalıştırır).
//
//   node scripts/backup.js [--label=kısa-ad]
//
// Hedef: <yedek klasörü>/Panel yedekleri/islem-oncesi/YYYY-AA-GG_SSDD[_ad]
// (uygulamanın günlük yedeği ayrı: Panel yedekleri/YYYY-AA-GG; o klasörlerin temizliğine karışmaz.)
const fs = require('fs');
const path = require('path');

const KEEP = 30;   // en son bu kadar işlem-öncesi yedek tutulur
const userData = process.env.PANEL_PROFILE || path.join(process.env.APPDATA || '', 'Panel');
const dataDir = path.join(userData, 'data');
const label = (process.argv.find(a => a.startsWith('--label=')) || '').slice(8).replace(/[^\w.-]+/g, '-');

function fail(msg) { console.error('YEDEK ALINAMADI: ' + msg); process.exit(1); }

if (!fs.existsSync(dataDir)) fail('veri klasörü yok: ' + dataDir);
let settings = {};
try { settings = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8')); } catch {}
// --dir=<yol>: kayıtlı klasör taşınmış/yeniden adlandırılmışsa geçici olarak başka klasöre yedekle
const dirArg = (process.argv.find(a => a.startsWith("--dir=")) || "").slice(6);
const dir = dirArg || settings.backup?.dir;
if (!dir) fail('uygulamada yedekleme klasörü seçilmemiş (Ayarlar → Bildirim & yedek).');
if (!fs.existsSync(dir)) fail('yedekleme klasörü bulunamadı: ' + dir);

const d = new Date();
const p2 = n => String(n).padStart(2, '0');
const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}`;
const root = path.join(dir, 'Panel yedekleri', 'islem-oncesi');
const dest = path.join(root, label ? `${stamp}_${label}` : stamp);
fs.mkdirSync(root, { recursive: true });
// (fs.cpSync bu Node sürümünde Türkçe karakterli hedef yolda sessizce kopyalamadı; elle kopyalanır)
const copyDir = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const f = path.join(from, e.name), t = path.join(to, e.name);
    if (e.isDirectory()) copyDir(f, t);
    else { fs.copyFileSync(f, t); const st = fs.statSync(f); fs.utimesSync(t, st.atime, st.mtime); }
  }
};
copyDir(dataDir, dest);

// Doğrulama: dosya sayısı ve boyutu kaynakla aynı mı
const tally = p => { let n = 0, b = 0; for (const e of fs.readdirSync(p, { withFileTypes: true })) { const f = path.join(p, e.name); if (e.isDirectory()) { const r = tally(f); n += r[0]; b += r[1]; } else { n++; b += fs.statSync(f).size; } } return [n, b]; };
const [n1, b1] = tally(dataDir), [n2, b2] = tally(dest);
if (n1 !== n2 || b1 !== b2) fail(`kopya eksik (${n1}/${n2} dosya, ${b1}/${b2} bayt)`);

// Eskileri temizle (yalnızca bu betiğin oluşturduğu, tarih ile başlayan klasörler)
const old = fs.readdirSync(root, { withFileTypes: true })
  .filter(e => e.isDirectory() && /^\d{4}-\d{2}-\d{2}_\d{4}/.test(e.name)).map(e => e.name).sort().reverse();
for (const name of old.slice(KEEP)) fs.rmSync(path.join(root, name), { recursive: true, force: true });

console.log(`Yedek alındı → ${dest}  (${n1} dosya, ${(b1 / 1024).toFixed(0)} KB)`);
