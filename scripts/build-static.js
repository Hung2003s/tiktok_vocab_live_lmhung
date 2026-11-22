// Tạo bản web tĩnh (chỉ xem) trong thư mục docs/ để đưa lên GitHub Pages.
// Dùng: node scripts/build-static.js https://server-cong-khai-cua-ban.example.com
const fs = require('fs');
const path = require('path');

const serverUrl = String(process.argv[2] || process.env.TVL_SERVER_URL || '').trim().replace(/\/+$/, '');
if (!/^https?:\/\//i.test(serverUrl)) {
  console.error('Thiếu địa chỉ server. Ví dụ: node scripts/build-static.js https://abc.trycloudflare.com');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const src = path.join(root, 'public');
const out = path.join(root, 'docs');
const SOCKET_IO_CDN = 'https://cdn.socket.io/4.8.4/socket.io.min.js';

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const file of ['index.html', 'bxh.html', 'styles.css', 'app.js']) {
  let text = fs.readFileSync(path.join(src, file), 'utf8');
  if (file.endsWith('.html')) {
    text = text.replace('/socket.io/socket.io.js', SOCKET_IO_CDN).replace('href="/bxh"', 'href="bxh.html"');
  }
  fs.writeFileSync(path.join(out, file), text);
}

fs.writeFileSync(
  path.join(out, 'config.js'),
  `window.TVL_SERVER_URL = ${JSON.stringify(serverUrl)};\nwindow.TVL_STATIC_VIEWER = true;\n`
);
fs.writeFileSync(path.join(out, '.nojekyll'), '');

console.log(`Đã tạo docs/ (chỉ xem) → kết nối tới ${serverUrl}`);
console.log('Server cần đặt: ALLOWED_ORIGINS=<địa chỉ trang tĩnh>, ví dụ https://hung2003s.github.io');
