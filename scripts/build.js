// Not editörünü src/vendor altına paketler (npm start ve npm run dist öncesi otomatik çalışır).
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'src', 'vendor');
fs.mkdirSync(out, { recursive: true });

esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'editor-entry.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'chrome120',
  outfile: path.join(out, 'editor.js'),
  logLevel: 'warning',
});

// Bulut (Firebase) istemcisi: yalnızca kullanılan parçalar paketlenir (js/cloud.js bunu kullanır)
esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'cloud-entry.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'chrome120',
  outfile: path.join(out, 'cloud.js'),
  logLevel: 'warning',
});

const dist = path.join(root, 'node_modules', '@toast-ui', 'editor', 'dist');
fs.copyFileSync(path.join(dist, 'toastui-editor.css'), path.join(out, 'editor.css'));
fs.copyFileSync(path.join(dist, 'theme', 'toastui-editor-dark.css'), path.join(out, 'editor-dark.css'));
// Hava durumu simgeleri (Meteocons, MIT): animasyonlu + animasyonsuz (küçük simgeler için) kopyalar
const icons = path.join(root, 'node_modules', '@bybas', 'weather-icons', 'production', 'fill', 'all');
const anim = path.join(out, 'weather', 'anim');
const still = path.join(out, 'weather', 'static');
fs.mkdirSync(anim, { recursive: true });
fs.mkdirSync(still, { recursive: true });
const ANIM_RE = /<animate(?:Transform)?\b[^>]*?(?:\/>|>[\s\S]*?<\/animate(?:Transform)?>)/g;
for (const f of fs.readdirSync(icons).filter(f => f.endsWith('.svg'))) {
  const svg = fs.readFileSync(path.join(icons, f), 'utf8');
  fs.writeFileSync(path.join(anim, f), svg);
  // Kesik çizgiler yalnızca animasyon için; sabit sürümde çizgiler tam görünsün
  fs.writeFileSync(path.join(still, f), svg.replace(ANIM_RE, '').replace(/\sstroke-dasharray="[^"]*"/g, ''));
}

console.log('Editör ve simgeler paketlendi → src/vendor');
