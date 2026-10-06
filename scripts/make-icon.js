// Uygulama logosunu üretir (tek kaynak → her yerde aynı logo):
//   assets/icon.png      256×256  (bildirimler, genel kullanım)
//   assets/icon.ico      16…256   (görev çubuğu, pencere, tepsi, kurulum dosyası)
//   src/icons/logo.svg   vektör   (uygulama içi)
// Harici bağımlılık yok: şekiller işaretli mesafe fonksiyonlarıyla (kenarları yumuşatılmış) çizilir,
// her boyut kendi çözünürlüğünde çizilir (küçük boyutlar bulanıklaşmaz).
//
// Tasarım: mavi-mor gradyanlı yuvarlak kare; içinde bir panel düzeni — büyük beyaz kartta onay işareti,
// yanında soluk kartlar. ("yapılacaklar + notlar + hava durumu" paneli)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---- Tasarım (256×256 tuval) ----
const BG = { x0: 8, y0: 8, x1: 248, y1: 248, r: 58, from: [111, 140, 255], to: [139, 92, 246] };
const TILES = [
  { x0: 54, y0: 54, x1: 126, y1: 134, r: 15, a: 0.97 },   // A: büyük, onay işaretli
  { x0: 138, y0: 54, x1: 202, y1: 104, r: 15, a: 0.62 },  // B
  { x0: 138, y0: 116, x1: 202, y1: 202, r: 15, a: 0.36 }, // C
  { x0: 54, y0: 146, x1: 126, y1: 202, r: 15, a: 0.52 },  // D
];
const CHECK = { pts: [[73, 96], [87, 110], [110, 77]], w: 13, color: [84, 104, 232] };

// ---- Çizim ----
const sdRoundRect = (px, py, t) => {
  const cx = (t.x0 + t.x1) / 2, cy = (t.y0 + t.y1) / 2, hw = (t.x1 - t.x0) / 2, hh = (t.y1 - t.y0) / 2;
  const qx = Math.abs(px - cx) - (hw - t.r), qy = Math.abs(py - cy) - (hh - t.r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - t.r;
};
const sdSegment = (px, py, [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay;
  const h = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - dx * h, py - ay - dy * h);
};
const cover = d => Math.max(0, Math.min(1, 0.5 - d));   // d: piksel cinsinden işaretli mesafe

function render(size) {
  const k = size / 256, px = Buffer.alloc(size * size * 4);
  const over = (i, [r, g, b], a) => {   // "source over" karışımı (alfa korunur)
    const ba = px[i + 3] / 255, oa = a + ba * (1 - a);
    if (oa <= 0) return;
    for (let c = 0; c < 3; c++) px[i + c] = Math.round(([r, g, b][c] * a + px[i + c] * ba * (1 - a)) / oa);
    px[i + 3] = Math.round(oa * 255);
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4, sx = (x + 0.5) / k, sy = (y + 0.5) / k;
      // Arka plan: köşegen gradyan + sol üstte yumuşak ışık
      const bg = cover(sdRoundRect(sx, sy, BG) * k);
      if (bg > 0) {
        const t = Math.max(0, Math.min(1, ((sx - BG.x0) + (sy - BG.y0)) / ((BG.x1 - BG.x0) + (BG.y1 - BG.y0))));
        over(i, BG.from.map((f, c) => f + (BG.to[c] - f) * t), bg);
        const glow = Math.max(0, 1 - Math.hypot(sx - 70, sy - 60) / 190) * 0.22;
        over(i, [255, 255, 255], glow * bg);
      }
      for (const t of TILES) over(i, [255, 255, 255], cover(sdRoundRect(sx, sy, t) * k) * t.a);
      // Onay işareti
      const d = Math.min(sdSegment(sx, sy, CHECK.pts[0], CHECK.pts[1]), sdSegment(sx, sy, CHECK.pts[1], CHECK.pts[2])) - CHECK.w / 2;
      over(i, CHECK.color, cover(d * k));
    }
  }
  return px;
}

// ---- PNG / ICO kodlama ----
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function encodePng(px, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;   // 8 bit RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
function encodeIco(images) {   // images: [{ size, png }]
  const head = Buffer.alloc(6 + images.length * 16);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, png }, n) => {
    const e = 6 + n * 16;
    head[e] = size >= 256 ? 0 : size; head[e + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...images.map(i => i.png)]);
}

// ---- SVG (aynı şekiller) ----
function svg() {
  const rect = (t, extra) => `<rect x="${t.x0}" y="${t.y0}" width="${t.x1 - t.x0}" height="${t.y1 - t.y0}" rx="${t.r}" ${extra}/>`;
  const rgb = c => `rgb(${c.join(',')})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <defs>
    <linearGradient id="bg" x1="${BG.x0}" y1="${BG.y0}" x2="${BG.x1}" y2="${BG.y1}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${rgb(BG.from)}"/><stop offset="1" stop-color="${rgb(BG.to)}"/>
    </linearGradient>
    <radialGradient id="glow" cx="70" cy="60" r="190" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  ${rect({ ...BG, r: BG.r }, 'fill="url(#bg)"')}
  ${rect({ ...BG, r: BG.r }, 'fill="url(#glow)"')}
  ${TILES.map(t => rect(t, `fill="#fff" fill-opacity="${t.a}"`)).join('\n  ')}
  <polyline points="${CHECK.pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="${rgb(CHECK.color)}" stroke-width="${CHECK.w}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;
}

// ---- Yaz ----
const root = path.join(__dirname, '..');
const write = (rel, data) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); console.log('Yazıldı:', rel); };
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const pngs = sizes.map(size => ({ size, png: encodePng(render(size), size) }));
write('assets/icon.png', pngs.find(p => p.size === 256).png);
write('assets/icon.ico', encodeIco(pngs));
write('src/icons/logo.svg', svg());
