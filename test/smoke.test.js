// Kiá»ƒm thá»­ nhanh: node test/smoke.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { matchAnswer } = require('../src/answer');
const { parseImport } = require('../src/importer');
const { JsonStore } = require('../src/store');
const { GameEngine } = require('../src/game-engine');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  âœ… ${name}`);
  } catch (err) {
    console.error(`  âŒ ${name}\n     ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('\n[answer]');
test('khá»›p chÃ­nh xÃ¡c', () => assert.deepStrictEqual(matchAnswer('convenient', 'convenient'), { ok: true, exact: true }));
test('khá»›p trong cÃ¢u tiáº¿ng Viá»‡t', () => assert.ok(matchAnswer('Ä‘Ã¡p Ã¡n lÃ  Convenient nha!!', 'convenient').ok));
test('sai 1 kÃ½ tá»± vá»›i tá»« dÃ i â†’ gáº§n Ä‘Ãºng', () => assert.deepStrictEqual(matchAnswer('conveniant', 'convenient'), { ok: true, exact: false }));
test('tá»« ngáº¯n khÃ´ng cháº¥p nháº­n sai chÃ­nh táº£', () => assert.ok(!matchAnswer('tap', 'tip').ok));
test('khÃ´ng khá»›p má»™t pháº§n tá»«', () => assert.ok(!matchAnswer('inconvenient', 'convenient').ok));
test('comment rÃ¡c khÃ´ng khá»›p', () => assert.ok(!matchAnswer('ðŸ˜‚ðŸ˜‚ðŸ˜‚', 'bug').ok));

console.log('\n[importer]');
test('nháº­p CSV cÃ³ ngoáº·c kÃ©p vÃ  collocations', () => {
  const csv = 'word,ipa,meaningVi,collocations\nDeadline,Ëˆded.laÉªn,"Háº¡n chÃ³t, thá»i háº¡n",meet the deadline|tight deadline';
  const { words, errors } = parseImport(csv);
  assert.strictEqual(errors.length, 0, errors.join());
  assert.strictEqual(words[0].word, 'deadline');
  assert.strictEqual(words[0].ipa, '/Ëˆded.laÉªn/');
  assert.strictEqual(words[0].collocations.length, 2);
});
test('cháº·n nghÄ©a chá»©a luÃ´n Ä‘Ã¡p Ã¡n', () => {
  const { errors } = parseImport([{ word: 'bug', ipa: '/bÊŒÉ¡/', meaningVi: 'lá»—i bug pháº§n má»m' }]);
  assert.strictEqual(errors.length, 1);
});

console.log('\n[engine]');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tvl-'));
const baseTopics = require('../data/vocabulary.json');
const engine = new GameEngine({
  baseTopics,
  configStore: new JsonStore(path.join(tmp, 'config.json'), {}),
  allTimeStore: new JsonStore(path.join(tmp, 'alltime.json'), { players: {} }),
  customWordsStore: new JsonStore(path.join(tmp, 'custom.json'), {}),
  hardware: { recommendedMaxParticipants: 300 }
});
engine.setConfig({ maxParticipants: 5, perUserCooldownMs: 0, streamDelaySec: 3, maxWinners: 3, demoBots: false });
engine.startTopic(0);
const word = engine.round.word.word;

test('lÃºc Ä‘oÃ¡n khÃ´ng gá»­i Ä‘Ã¡p Ã¡n xuá»‘ng client', () => {
  const s = engine.snapshot();
  assert.strictEqual(s.answer, null);
  assert.ok(!JSON.stringify(s.question).toLowerCase().includes(`"${word}"`));
  assert.ok(s.question.slots.some((c) => c === null));
  assert.ok(!/[A-Z]{3,}-/.test(s.question.stressHint), 'khÃ´ng lá»™ phiÃªn Ã¢m Ä‘á»c bá»“i');
});

test('comment sai khÃ´ng tÃ­nh Ä‘iá»ƒm', () => {
  const r = engine.handleComment({ uniqueId: 'u1', nickname: 'U1', comment: 'hello' });
  assert.strictEqual(r.correct, false);
  assert.strictEqual(engine.round.phase, 'GUESSING');
});

test('ngÆ°á»i Ä‘Ãºng Ä‘áº§u tiÃªn +10 vÃ  má»Ÿ Ä‘Ã¡p Ã¡n', () => {
  const r = engine.handleComment({ uniqueId: 'u1', nickname: 'U1', comment: word });
  assert.strictEqual(r.points, 10);
  assert.strictEqual(engine.round.phase, 'REVEAL');
  assert.ok(engine.snapshot().answer.word === word);
});

test('tráº£ lá»i láº¡i khÃ´ng Ä‘Æ°á»£c cá»™ng 2 láº§n', () => {
  const r = engine.handleComment({ uniqueId: 'u1', nickname: 'U1', comment: word });
  assert.strictEqual(r.correct, false);
});

test('ngÆ°á»i xem bá»‹ trá»… live váº«n Ä‘Æ°á»£c háº¡ng 2 (+7) trong cá»­a sá»• bÃ¹ trá»…', () => {
  const r = engine.handleComment({ uniqueId: 'u2', nickname: 'U2', comment: word });
  assert.strictEqual(r.points, 7);
});

test('quÃ¡ cá»­a sá»• bÃ¹ trá»… thÃ¬ khÃ´ng nháº­n ná»¯a', () => {
  engine.round.acceptUntil = Date.now() - 1;
  const r = engine.handleComment({ uniqueId: 'u3', nickname: 'U3', comment: word });
  assert.strictEqual(r.correct, false);
});

test('giá»›i háº¡n ngÆ°á»i tham gia: ngÆ°á»i thá»© 6 bá»‹ tá»« chá»‘i', () => {
  ['u4', 'u5', 'u6'].forEach((u) => engine.handleComment({ uniqueId: u, nickname: u, comment: 'hi' }));
  assert.strictEqual(engine.live.participants.size, 5);
  assert.strictEqual(engine.live.dropped, 1);
});

test('BXH phiÃªn + lá»‹ch sá»­ + BXH tá»•ng', () => {
  engine.next();
  const s = engine.snapshot();
  assert.strictEqual(s.phase, 'GUESSING');
  assert.strictEqual(s.leaderboard[0].nickname, 'U1');
  assert.strictEqual(s.history[0].winners.length, 2);
  assert.strictEqual(s.allTime[0].score, 10);
});

test('bot / host khÃ´ng vÃ o BXH tá»•ng', () => {
  const w = engine.round.word.word;
  engine.handleComment({ uniqueId: 'host', nickname: 'Host', comment: w, source: 'host' });
  assert.ok(!engine.allTimeBoard().some((p) => p.nickname === 'Host'));
});

test('táº¡m dá»«ng thÃ¬ Ä‘á»“ng há»“ Ä‘á»©ng yÃªn', () => {
  engine.next();
  const before = engine.round.endsAt;
  engine.pause();
  engine.pausedAt -= 3000; // giáº£ láº­p Ä‘Ã£ dá»«ng 3 giÃ¢y
  engine.resume();
  assert.ok(engine.round.endsAt - before >= 2900);
});

test('nháº­p thÃªm tá»« vÃ o chá»§ Ä‘á»', () => {
  const res = engine.addWords(baseTopics[0].id, parseImport([{ word: 'zebracrossing', ipa: '/kÉ™ËˆmjuËt/', meaningVi: 'Äi láº¡i háº±ng ngÃ y giá»¯a nhÃ  vÃ  nÆ¡i lÃ m' }]).words);
  assert.strictEqual(res.added, 1);
  assert.ok(engine.topics[0].words.some((w) => w.word === 'zebracrossing'));
});

test('tên TikTok "__proto__" không làm nhiễm prototype', () => {
  engine.next();
  const w = engine.round.word.word;
  engine.setConfig({ maxParticipants: 50 });
  engine.handleComment({ uniqueId: '__proto__', nickname: 'hacker', comment: w });
  engine.handleComment({ uniqueId: 'constructor', nickname: 'hacker2', comment: w });
  assert.strictEqual({}.nickname, undefined);
  assert.strictEqual({}.score, undefined);
  assert.ok(engine.allTimeBoard().some((p) => p.nickname === 'hacker'));
});

engine.stop();

test('tặng quà Rose đổi sang chủ đề Đời sống, cooldown chặn quà liền sau', () => {
  engine.setConfig({ giftCooldownSec: 60 });
  engine.lastGiftSwitch = 0;
  engine.startTopic(2);
  engine.handleGift({ nickname: 'fan', giftName: 'Rose' });
  assert.strictEqual(engine.currentTopic().id, 'session_daily');
  engine.handleGift({ nickname: 'fan2', giftName: 'Ice Cream Cone' });
  assert.strictEqual(engine.currentTopic().id, 'session_daily');
});

// ---------------------------------------------------------------- tÃ­ch há»£p server tháº­t
console.log('\n[server]');
const PORT = 3999;
const child = spawn(process.execPath, ['server.js'], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe']
});
let logs = '';
child.stdout.on('data', (d) => (logs += d));
child.stderr.on('data', (d) => (logs += d));

const { io } = require('socket.io-client');
setTimeout(async () => {
  try {
    const info = await fetch(`http://localhost:${PORT}/api/info`).then((r) => r.json());
    test('GET /api/info cÃ³ sá»‘ Ä‘o pháº§n cá»©ng', () => assert.ok(info.hardware.judgedPerSec > 1000));

    const page = await fetch(`http://localhost:${PORT}/bxh`).then((r) => r.status);
    test('GET /bxh tráº£ vá» 200', () => assert.strictEqual(page, 200));

    const sock = io(`http://localhost:${PORT}`, { transports: ['websocket'] });
    const state = await new Promise((resolve, reject) => {
      sock.on('game:state', resolve);
      setTimeout(() => reject(new Error('khÃ´ng nháº­n Ä‘Æ°á»£c game:state')), 4000);
    });
    test('socket nháº­n game:state Ä‘áº§y Ä‘á»§', () => {
      assert.strictEqual(state.phase, 'GUESSING');
      assert.ok(state.topics.length >= 6);
      assert.ok(state.tiktok && state.tiktok.status);
    });
    sock.close();

    // ---- bảo mật
    const bad = await fetch(`http://localhost:${PORT}/api/words`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad json'
    });
    const badText = await bad.text();
    test('JSON lỗi không làm lộ stack trace / đường dẫn file', () => {
      assert.strictEqual(bad.status, 400);
      assert.ok(!/node_modules|at JSON\.parse|\\Users\\/.test(badText), badText);
    });

    test('có header chống clickjacking & lộ referrer', () => {
      assert.strictEqual(bad.headers.get('x-frame-options'), 'DENY');
      assert.strictEqual(bad.headers.get('referrer-policy'), 'no-referrer');
      assert.strictEqual(bad.headers.get('x-powered-by'), null);
    });

    const evil = await fetch(`http://localhost:${PORT}/socket.io/?EIO=4&transport=polling`, {
      headers: { Origin: 'https://evil.example' }
    });
    test('trang web lạ không kết nối ngầm được vào socket', () => assert.notStrictEqual(evil.status, 200));

    const hello = (url) =>
      new Promise((resolve, reject) => {
        const s = io(url, { transports: ['websocket'] });
        s.on('game:hello', (h) => {
          s.close();
          resolve(h);
        });
        setTimeout(() => reject(new Error(`không nhận được game:hello từ ${url}`)), 4000);
      });
    const localHello = await hello(`http://localhost:${PORT}`);
    test('máy chạy server (localhost) có quyền điều khiển', () => assert.strictEqual(localHello.isHost, true));

    const lanIp = info.lanIps[0];
    if (lanIp) {
      const lanHello = await hello(`http://${lanIp}:${PORT}`);
      test(`thiết bị qua mạng LAN (${lanIp}) chỉ được xem`, () => assert.strictEqual(lanHello.isHost, false));
    }
  } catch (err) {
    console.error('  âŒ server:', err.message, '\n', logs);
    process.exitCode = 1;
  } finally {
    child.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`\n${passed} bÃ i kiá»ƒm thá»­ Ä‘áº¡t${process.exitCode ? ' â€” CÃ“ Lá»–I' : ''}\n`);
  }
}, 2500);
