const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Server } = require('socket.io');

const { GameEngine } = require('./src/game-engine');
const { TikTokBridge } = require('./src/tiktok-bridge');
const { JsonStore } = require('./src/store');
const { getHardwareProfile, benchmarkJudging } = require('./src/hardware');
const { parseImport } = require('./src/importer');

const PORT = Number(process.env.PORT) || 3000;
// 0.0.0.0 = cho điện thoại cùng Wi-Fi truy cập. Đặt 127.0.0.1 nếu chỉ dùng trên chính máy này.
const BIND_HOST = process.env.BIND_HOST || '0.0.0.0';
// Không đặt HOST_KEY: chỉ máy chạy server (localhost) được điều khiển.
// Có HOST_KEY: thiết bị nào mở URL có ?key=<HOST_KEY> cũng điều khiển được.
const HOST_KEY = process.env.HOST_KEY || '';
const DATA_DIR = path.join(__dirname, 'data');

// ------------------------------------------------------------------ khởi tạo
const hardware = { ...getHardwareProfile(), judgedPerSec: benchmarkJudging() };
const baseTopics = require(path.join(DATA_DIR, 'vocabulary.json'));

const configStore = new JsonStore(path.join(DATA_DIR, 'config.json'), {});
const allTimeStore = new JsonStore(path.join(DATA_DIR, 'leaderboard-alltime.json'), { players: {} });
const customWordsStore = new JsonStore(path.join(DATA_DIR, 'custom-words.json'), {});

const engine = new GameEngine({ baseTopics, configStore, allTimeStore, customWordsStore, hardware });
const tiktok = new TikTokBridge();

// ------------------------------------------------------------------ bảo mật
function isLoopback(address) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(String(address || ''));
}

function keyMatches(candidate) {
  if (!HOST_KEY || typeof candidate !== 'string') return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(HOST_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function canControl({ address, key }) {
  return HOST_KEY ? keyMatches(key) : isLoopback(address);
}

// Chặn trang web lạ (mở trong trình duyệt của bạn) kết nối ngầm vào server rồi gửi lệnh
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // không phải trình duyệt (vd: script kiểm thử)
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

const app = express();
app.disable('x-powered-by');
const server = http.createServer(app);
const io = new Server(server, {
  allowRequest: (req, callback) => callback(null, sameOrigin(req)),
  maxHttpBufferSize: 64 * 1024
});

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY'); // chống nhúng trang điều khiển vào web khác (clickjacking)
  res.setHeader('Referrer-Policy', 'no-referrer'); // không làm lộ ?key= qua header Referer
  next();
});
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
// Dùng `root` để Express không chặn đường dẫn vì thư mục cha có dấu chấm (vd: .gemini)
app.get('/bxh', (req, res) => res.sendFile('bxh.html', { root: path.join(__dirname, 'public') }));

function getLanIPs() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
    .map((i) => i.address);
}

app.get('/api/info', (req, res) => {
  res.json({
    port: PORT,
    lanIps: getLanIPs(),
    hostKeyRequired: Boolean(HOST_KEY),
    canControl: canControl({ address: req.socket.remoteAddress, key: req.get('x-host-key') }),
    hardware
  });
});

app.post('/api/words', (req, res) => {
  if (!sameOrigin(req) || !canControl({ address: req.socket.remoteAddress, key: req.get('x-host-key') })) {
    return res.status(403).json({ error: 'Thiết bị này không có quyền điều khiển' });
  }
  try {
    const { topicId, content } = req.body || {};
    const { words, errors } = parseImport(content);
    if (!words.length) return res.status(400).json({ error: 'Không có từ hợp lệ', errors });
    const result = engine.addWords(String(topicId || ''), words);
    return res.json({ ...result, errors });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// Không trả stack trace / đường dẫn file ra ngoài khi có lỗi
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('[http]', err);
  res.status(status).json({ error: status === 400 ? 'Dữ liệu gửi lên không hợp lệ' : 'Lỗi máy chủ' });
});

// ------------------------------------------------------------------ realtime
engine.on('state', (state) => io.emit('game:state', { ...state, tiktok: tiktok.snapshot() }));
engine.on('feed', (item) => io.emit('game:feed', item));
engine.on('speak', (payload) => io.emit('game:speak', payload));
engine.on('sfx', (payload) => io.emit('game:sfx', payload));

tiktok.on('chat', (chat) => engine.handleComment({ ...chat, source: 'tiktok' }));
tiktok.on('gift', (gift) => engine.handleGift(gift));
tiktok.on('status', () => engine.scheduleEmit());

const HOST_ACTIONS = new Set([
  'next', 'reveal', 'hint', 'board', 'pause', 'selectTopic', 'moveTopic',
  'newLive', 'resetParticipants', 'resetAllTime', 'simCorrect', 'setConfig'
]);

io.on('connection', (socket) => {
  const isHost = canControl({ address: socket.handshake.address, key: socket.handshake.auth?.key });
  socket.emit('game:hello', { isHost, hostKeyRequired: Boolean(HOST_KEY) });
  socket.emit('game:state', { ...engine.snapshot(), tiktok: tiktok.snapshot() });

  // Giới hạn tần suất lệnh để một thiết bị không thể dội hàng nghìn lệnh/giây
  let budget = 20;
  const refill = setInterval(() => (budget = Math.min(20, budget + 10)), 1000);
  socket.on('disconnect', () => clearInterval(refill));

  const hostOnly = (handler) => (...args) => {
    if (!isHost) {
      socket.emit('game:error', 'Thiết bị này chỉ được xem, không có quyền điều khiển.');
      return;
    }
    if (budget <= 0) return;
    budget -= 1;
    try {
      handler(...args);
    } catch (err) {
      console.error('[host]', err.message);
    }
  };

  socket.on(
    'host:cmd',
    hostOnly(({ action, payload } = {}) => {
      if (HOST_ACTIONS.has(action)) engine.command(action, payload && typeof payload === 'object' ? payload : {});
    })
  );

  socket.on(
    'host:answer',
    hostOnly(({ comment } = {}) =>
      engine.handleComment({ uniqueId: 'host', nickname: '🎙️ Host', comment: String(comment || '').slice(0, 200), source: 'host' })
    )
  );

  socket.on('tiktok:connect', hostOnly(({ username } = {}) => tiktok.connect(String(username || '').slice(0, 100))));
  socket.on('tiktok:disconnect', hostOnly(() => tiktok.disconnect()));
});

// ------------------------------------------------------------------ chạy
engine.start();

server.listen(PORT, BIND_HOST, () => {
  const lan = BIND_HOST === '0.0.0.0' ? getLanIPs() : [];
  console.log('\n==================================================');
  console.log('🚀 TIKTOK LIVE VOCAB SERVER');
  console.log(
    `💻 ${hardware.cpuCount} luồng CPU | RAM ${hardware.totalRamGB}GB | chấm được ~${hardware.judgedPerSec.toLocaleString('vi-VN')} comment/giây`
  );
  console.log(`🖥️  Điều khiển (chỉ máy này): http://localhost:${PORT}`);
  console.log(`🏆 Bảng xếp hạng:            http://localhost:${PORT}/bxh`);
  lan.forEach((ip) => console.log(`📱 Màn hình treo live (đt):  http://${ip}:${PORT}/?mode=stream`));
  console.log(
    HOST_KEY
      ? '🔒 HOST_KEY đang bật: thiết bị nào có ?key=... mới điều khiển được'
      : '🔒 Chỉ máy chạy server được điều khiển; thiết bị khác chỉ xem'
  );
  if (!process.env.TIKTOK_SIGN_API_KEY) console.log('ℹ️  Chưa có TIKTOK_SIGN_API_KEY (Euler Stream): kết nối TikTok dùng gói miễn phí, có thể bị giới hạn.');
  console.log('==================================================\n');
});

function shutdown() {
  allTimeStore.flush();
  configStore.flush();
  customWordsStore.flush();
  tiktok.disconnect(false);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
