// Sürüm notları: kaynak dosyalar surum-notlari/v<sürüm>.txt (depoda tutulur).
// Bu betik her dist/v<sürüm>/ klasörüne ilgili notu "Surum-Notlari.txt" olarak kopyalar
// (npm run dist sonunda kendiliğinden çalışır; elle: npm run notes).
// Yeni sürümde yapılacak tek şey: surum-notlari/v<yeni>.txt dosyasını yazmak.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'surum-notlari');
const dist = path.join(root, 'dist');
const current = require(path.join(root, 'package.json')).version;

if (!fs.existsSync(path.join(src, `v${current}.txt`))) {
  console.error(`UYARI: surum-notlari/v${current}.txt yok; bu sürümün notunu yazmayı unutma.`);
}
let n = 0;
for (const f of fs.readdirSync(src).filter(f => /^v\d+\.\d+\.\d+\.txt$/.test(f))) {
  const dir = path.join(dist, f.replace(/\.txt$/, ''));
  if (!fs.existsSync(dir)) continue;   // o sürümün paketi yoksa atla
  fs.copyFileSync(path.join(src, f), path.join(dir, 'Surum-Notlari.txt'));
  n++;
}
console.log(`Sürüm notları ${n} klasöre kopyalandı (dist/v*/Surum-Notlari.txt).`);
