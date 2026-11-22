// Bộ máy trò chơi chạy trên server: là nguồn sự thật duy nhất cho câu hỏi, đồng hồ, chấm điểm và BXH.
// Mọi màn hình (điện thoại treo live, máy tính điều khiển, trang /bxh) chỉ hiển thị trạng thái này.
const EventEmitter = require('events');
const { matchAnswer } = require('./answer');

const POINT_LADDER = [10, 7, 5, 3, 2];
const TICK_MS = 200;
const FEED_CHAT_PER_SEC = 4;

const DEFAULT_CONFIG = {
  guessSec: 20,
  explainSec: 10,
  leaderboardSec: 6,
  streamDelaySec: 4,
  maxWinners: 3,
  consolationPoints: 1,
  maxParticipants: 300,
  perUserCooldownMs: 1500,
  resetParticipantsOnTopicChange: false,
  autoRotateTopics: true,
  shuffleWords: true,
  autoHints: true,
  audioHint: true,
  demoBots: false,
  giftChangesTopic: true,
  giftCooldownSec: 20,
  topicOrder: []
};

const CONFIG_RULES = {
  giftCooldownSec: [0, 300],
  guessSec: [8, 90],
  explainSec: [4, 40],
  leaderboardSec: [0, 20],
  streamDelaySec: [0, 15],
  maxWinners: [1, 5],
  consolationPoints: [0, 5],
  maxParticipants: [5, 5000],
  perUserCooldownMs: [0, 10000]
};

const BOOLEAN_KEYS = [
  'resetParticipantsOnTopicChange',
  'autoRotateTopics',
  'shuffleWords',
  'autoHints',
  'audioHint',
  'demoBots',
  'giftChangesTopic'
];

const DEMO_BOTS = [
  { uniqueId: 'demo_minhanh', nickname: '🤖 Minh Anh' },
  { uniqueId: 'demo_hoangit', nickname: '🤖 Hoàng IT' },
  { uniqueId: 'demo_thaohr', nickname: '🤖 Thảo HR' },
  { uniqueId: 'demo_kiet', nickname: '🤖 Tuấn Kiệt' },
  { uniqueId: 'demo_linh', nickname: '🤖 Linh F&B' }
];

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function stressHintOf(word) {
  const m = String(word.stress || '').match(/Trọng âm \d|\d âm tiết/i);
  return m ? m[0] : '';
}

class GameEngine extends EventEmitter {
  constructor({ baseTopics, configStore, allTimeStore, customWordsStore, hardware }) {
    super();
    this.baseTopics = baseTopics;
    this.configStore = configStore;
    this.allTimeStore = allTimeStore;
    this.customWordsStore = customWordsStore;
    this.hardware = hardware;

    const saved = configStore.get() || {};
    this.config = this.sanitizeConfig({
      ...DEFAULT_CONFIG,
      maxParticipants: hardware.recommendedMaxParticipants,
      ...saved
    });

    this.topics = this.buildTopics();
    this.topicIdx = 0;
    this.words = [];
    this.wordIdx = 0;
    this.round = null;
    this.roundSeq = 0;
    this.paused = false;
    this.pausedAt = 0;

    this.resetLiveState();

    this.emitTimer = null;
    this.feedBudget = FEED_CHAT_PER_SEC;
    this.tickHandle = null;
  }

  // ---------------------------------------------------------------- cấu hình
  sanitizeConfig(raw) {
    const cfg = { ...DEFAULT_CONFIG };
    for (const [key, [min, max]] of Object.entries(CONFIG_RULES)) {
      const val = Number(raw[key]);
      cfg[key] = Number.isFinite(val) ? Math.min(max, Math.max(min, Math.round(val))) : DEFAULT_CONFIG[key];
    }
    for (const key of BOOLEAN_KEYS) {
      cfg[key] = raw[key] === undefined ? DEFAULT_CONFIG[key] : Boolean(raw[key]);
    }
    cfg.topicOrder = Array.isArray(raw.topicOrder) ? raw.topicOrder.map(String) : [];
    return cfg;
  }

  setConfig(partial) {
    const currentTopicId = this.currentTopic()?.id;
    this.config = this.sanitizeConfig({ ...this.config, ...partial });
    this.configStore.set(this.config);
    if (partial.topicOrder) {
      this.topics = this.buildTopics();
      const idx = this.topics.findIndex((t) => t.id === currentTopicId);
      this.topicIdx = idx >= 0 ? idx : 0;
    }
    this.scheduleEmit();
  }

  get points() {
    return POINT_LADDER.slice(0, this.config.maxWinners);
  }

  // ---------------------------------------------------------------- dữ liệu chủ đề
  buildTopics() {
    const custom = this.customWordsStore.get() || {};
    const topics = this.baseTopics.map((t) => ({
      ...t,
      words: [...t.words, ...(Array.isArray(custom[t.id]) ? custom[t.id] : [])]
    }));
    const order = this.config.topicOrder;
    if (order.length) {
      topics.sort((a, b) => {
        const ia = order.indexOf(a.id);
        const ib = order.indexOf(b.id);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      });
    }
    return topics.filter((t) => t.words.length > 0);
  }

  addWords(topicId, words) {
    const topic = this.baseTopics.find((t) => t.id === topicId);
    if (!topic) throw new Error('Chủ đề không tồn tại');

    const custom = this.customWordsStore.get() || {};
    const list = Array.isArray(custom[topicId]) ? custom[topicId] : [];
    const existing = new Set([...topic.words, ...list].map((w) => w.word.toLowerCase()));

    let added = 0;
    const skipped = [];
    for (const w of words) {
      const key = w.word.toLowerCase();
      if (existing.has(key)) {
        skipped.push(w.word);
        continue;
      }
      existing.add(key);
      list.push({ ...w, id: `custom_${Date.now()}_${added}` });
      added += 1;
    }
    custom[topicId] = list;
    this.customWordsStore.set(custom);

    const currentTopicId = this.currentTopic()?.id;
    this.topics = this.buildTopics();
    const idx = this.topics.findIndex((t) => t.id === currentTopicId);
    this.topicIdx = idx >= 0 ? idx : 0;
    this.scheduleEmit();
    return { added, skipped };
  }

  currentTopic() {
    return this.topics[this.topicIdx];
  }

  currentWord() {
    return this.round ? this.round.word : null;
  }

  // ---------------------------------------------------------------- phiên live
  resetLiveState() {
    this.live = {
      id: `live_${Date.now()}`,
      startedAt: Date.now(),
      participants: new Set(),
      dropped: 0,
      comments: 0,
      correct: 0
    };
    this.sessionBoard = new Map();
    this.history = [];
    this.lastCommentAt = new Map();
  }

  newLive() {
    this.resetLiveState();
    this.pushFeed('system', 'Hệ thống', 'Bắt đầu phiên live mới — BXH phiên đã được làm mới!');
    this.scheduleEmit();
  }

  resetParticipants() {
    this.live.participants.clear();
    this.live.dropped = 0;
    this.scheduleEmit();
  }

  // ---------------------------------------------------------------- vòng đời câu hỏi
  start() {
    this.startTopic(0);
    this.tickHandle = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    clearInterval(this.tickHandle);
  }

  startTopic(idx) {
    if (!this.topics.length) return;
    const prevTopicId = this.currentTopic()?.id;
    this.topicIdx = ((idx % this.topics.length) + this.topics.length) % this.topics.length;
    const topic = this.currentTopic();
    this.words = this.config.shuffleWords ? shuffle(topic.words) : [...topic.words];
    this.wordIdx = 0;
    if (prevTopicId && prevTopicId !== topic.id) {
      if (this.config.resetParticipantsOnTopicChange) this.resetParticipants();
      this.pushFeed('system', 'Hệ thống', `Chuyển sang chủ đề ${topic.icon} ${topic.title}`);
    }
    this.startRound();
  }

  startRound() {
    const word = this.words[this.wordIdx];
    if (!word) return;
    const now = Date.now();
    const letters = word.word.trim();

    this.round = {
      id: ++this.roundSeq,
      word,
      phase: 'GUESSING',
      startedAt: now,
      phaseStartedAt: now,
      endsAt: now + this.config.guessSec * 1000,
      revealed: new Set(),
      hintsDone: new Set(),
      winners: [],
      scored: new Set(),
      revealedAt: 0,
      acceptUntil: 0,
      revealReason: null,
      finished: false,
      botPlanned: false
    };

    if (this.config.autoHints && letters.length >= 4) this.round.revealed.add(0);
    this.scheduleEmit();
  }

  tick() {
    // Ngân sách hiển thị comment trong feed (tránh dội hàng trăm dòng xuống điện thoại)
    this.feedBudget = Math.min(FEED_CHAT_PER_SEC, this.feedBudget + (FEED_CHAT_PER_SEC * TICK_MS) / 1000);

    const r = this.round;
    if (!r || this.paused) return;
    const now = Date.now();

    if (r.phase === 'GUESSING') {
      const progress = (now - r.startedAt) / (r.endsAt - r.startedAt);
      if (this.config.autoHints) {
        this.maybeHint('letter1', progress >= 0.55);
        this.maybeHint('letter2', progress >= 0.75);
      }
      if (this.config.audioHint && progress >= 0.35 && !r.hintsDone.has('audio')) {
        r.hintsDone.add('audio');
        this.emit('speak', { text: r.word.word, rate: 0.85, reason: 'hint' });
      }
      if (this.config.demoBots) this.maybeRunDemoBots(progress);
      if (now >= r.endsAt) this.reveal('timeout');
    } else if (r.phase === 'REVEAL') {
      if (now >= r.endsAt) this.showBoard();
    } else if (r.phase === 'LEADERBOARD') {
      if (now >= r.endsAt) this.next();
    }
  }

  maybeHint(tag, due) {
    const r = this.round;
    if (!due || r.hintsDone.has(tag)) return;
    r.hintsDone.add(tag);
    this.revealLetter(0.5);
  }

  revealLetter(maxRatio = 0.7) {
    const r = this.round;
    if (!r || r.phase !== 'GUESSING') return false;
    const word = r.word.word.trim();
    const candidates = [];
    for (let i = 0; i < word.length; i++) {
      if (!r.revealed.has(i) && /[a-z]/i.test(word[i])) candidates.push(i);
    }
    const letterCount = word.replace(/[^a-z]/gi, '').length;
    if (candidates.length <= 1 || r.revealed.size >= Math.floor(letterCount * maxRatio)) return false;
    r.revealed.add(candidates[Math.floor(Math.random() * candidates.length)]);
    this.emit('sfx', { type: 'hint' });
    this.scheduleEmit();
    return true;
  }

  reveal(reason) {
    const r = this.round;
    if (!r || r.phase !== 'GUESSING') return;
    const now = Date.now();
    const graceMs = this.config.streamDelaySec * 1000;
    r.phase = 'REVEAL';
    r.revealReason = reason;
    r.revealedAt = now;
    r.phaseStartedAt = now;
    r.acceptUntil = now + graceMs;
    r.endsAt = now + Math.max(this.config.explainSec * 1000, graceMs + 1000);
    this.emit('sfx', { type: reason === 'winner' ? 'success' : 'reveal' });
    this.emit('speak', { text: `${r.word.word}. ${r.word.exampleEn || ''}`, rate: 0.9, reason: 'reveal' });
    this.scheduleEmit();
  }

  showBoard() {
    const r = this.round;
    if (!r) return;
    this.finishRound();
    if (this.config.leaderboardSec <= 0) {
      this.next();
      return;
    }
    r.phase = 'LEADERBOARD';
    r.phaseStartedAt = Date.now();
    r.endsAt = Date.now() + this.config.leaderboardSec * 1000;
    this.emit('sfx', { type: 'board' });
    this.scheduleEmit();
  }

  next() {
    this.finishRound();
    this.wordIdx += 1;
    if (this.wordIdx >= this.words.length) {
      if (this.config.autoRotateTopics) {
        this.startTopic(this.topicIdx + 1);
        return;
      }
      this.words = this.config.shuffleWords ? shuffle(this.words) : this.words;
      this.wordIdx = 0;
    }
    this.startRound();
  }

  finishRound() {
    const r = this.round;
    if (!r || r.finished) return;
    if (r.phase === 'GUESSING') {
      // Bị bỏ qua trước khi mở đáp án → vẫn ghi lịch sử
      r.revealReason = 'skipped';
    }
    r.finished = true;

    // Chuỗi đúng liên tiếp: ai không trả lời đúng câu này thì mất chuỗi
    for (const [key, entry] of this.sessionBoard) {
      if (!r.scored.has(key)) entry.streak = 0;
    }

    this.history.unshift({
      roundId: r.id,
      word: r.word.word,
      ipa: r.word.ipa,
      meaningVi: r.word.meaningVi,
      topicTitle: this.currentTopic()?.title || '',
      winners: r.winners.map((w) => ({ nickname: w.nickname, points: w.points, timeSec: w.timeSec })),
      at: Date.now()
    });
    if (this.history.length > 30) this.history.length = 30;
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.pausedAt = Date.now();
    this.scheduleEmit();
  }

  resume() {
    if (!this.paused) return;
    const delta = Date.now() - this.pausedAt;
    const r = this.round;
    if (r) {
      r.startedAt += delta;
      r.phaseStartedAt += delta;
      r.endsAt += delta;
      if (r.acceptUntil) r.acceptUntil += delta;
    }
    this.paused = false;
    this.scheduleEmit();
  }

  // ---------------------------------------------------------------- chấm comment
  handleComment({ uniqueId, nickname, comment, source = 'tiktok' }) {
    const now = Date.now();
    const id = String(uniqueId || nickname || 'viewer').toLowerCase().trim();
    const key = source === 'tiktok' ? id : `${source}:${id}`;
    const isTest = source !== 'tiktok';
    this.live.comments += 1;

    // Giới hạn số người tham gia phiên (chỉ áp dụng cho người xem thật)
    if (!isTest && !this.live.participants.has(key)) {
      if (this.live.participants.size >= this.config.maxParticipants) {
        this.live.dropped += 1;
        this.scheduleEmit();
        return { accepted: false, reason: 'FULL' };
      }
      this.live.participants.add(key);
      this.scheduleEmit();
    }

    const r = this.round;
    const accepting =
      r && !this.paused && (r.phase === 'GUESSING' || (r.phase === 'REVEAL' && now <= r.acceptUntil));

    // Chống spam đoán mò: mỗi người chỉ được chấm 1 lần / cooldown
    const last = this.lastCommentAt.get(key) || 0;
    const coolingDown = now - last < this.config.perUserCooldownMs;
    this.lastCommentAt.set(key, now);

    let result = { accepted: true, correct: false };
    if (accepting && !coolingDown && !r.scored.has(key)) {
      const match = matchAnswer(comment, r.word.word);
      if (match.ok) {
        result = this.recordWinner({ key, nickname: nickname || id, exact: match.exact, isTest, now });
      }
    }

    if (!result.correct) this.pushFeed('chat', nickname || id, comment);
    return result;
  }

  recordWinner({ key, nickname, exact, isTest, now }) {
    const r = this.round;
    const rank = r.winners.length;
    let points = rank < this.points.length ? this.points[rank] : this.config.consolationPoints;
    if (!exact) points = Math.max(1, Math.round(points / 2));
    const timeSec = Math.round((now - r.startedAt) / 100) / 10;

    const winner = { key, nickname, points, timeSec, exact, rank: rank + 1, isTest, late: r.phase === 'REVEAL' };
    r.winners.push(winner);
    r.scored.add(key);
    this.live.correct += 1;
    this.addScore(winner, r.word.word);

    const medal = ['🥇', '🥈', '🥉'][rank] || '✅';
    const typoNote = exact ? '' : ' (sai chính tả nhẹ, ½ điểm)';
    this.pushFeed('correct', nickname, `${medal} đúng "${r.word.word.toUpperCase()}" +${points}đ${typoNote}`);

    if (r.phase === 'GUESSING') this.reveal('winner');
    else this.emit('sfx', { type: 'success' });
    this.scheduleEmit();
    return { accepted: true, correct: true, points, rank: rank + 1 };
  }

  addScore(winner, word) {
    const entry = this.sessionBoard.get(winner.key) || {
      nickname: winner.nickname,
      score: 0,
      correct: 0,
      streak: 0,
      bestTimeSec: null,
      lastWord: '',
      isTest: winner.isTest
    };
    entry.nickname = winner.nickname;
    entry.score += winner.points;
    entry.correct += 1;
    entry.streak += 1;
    entry.lastWord = word;
    if (entry.bestTimeSec === null || winner.timeSec < entry.bestTimeSec) entry.bestTimeSec = winner.timeSec;
    this.sessionBoard.set(winner.key, entry);

    if (winner.isTest) return;
    // Khoá lưu trữ có tiền tố "u:" để tên TikTok như "__proto__" / "constructor" không thể
    // ghi đè prototype của object (lỗ hổng prototype pollution).
    const storeKey = `u:${winner.key}`;
    const store = this.allTimeStore.get() || { players: {} };
    const players = store.players;
    const p = Object.prototype.hasOwnProperty.call(players, storeKey)
      ? players[storeKey]
      : { nickname: winner.nickname, score: 0, correct: 0, lives: 0, lastLiveId: null };
    p.nickname = winner.nickname;
    p.score += winner.points;
    p.correct += 1;
    if (p.lastLiveId !== this.live.id) {
      p.lives += 1;
      p.lastLiveId = this.live.id;
    }
    p.lastSeen = Date.now();
    players[storeKey] = p;
    this.allTimeStore.set(store);
  }

  resetAllTime() {
    this.allTimeStore.set({ players: {} });
    this.scheduleEmit();
  }

  // ---------------------------------------------------------------- demo (chỉ để thử nghiệm)
  maybeRunDemoBots(progress) {
    const r = this.round;
    if (r.botPlanned || progress < 0.45) return;
    r.botPlanned = true;
    if (Math.random() < 0.25) return; // thỉnh thoảng không ai trả lời được
    const delay = Math.random() * (r.endsAt - Date.now()) * 0.7;
    const roundId = r.id;
    setTimeout(() => this.simulateCorrect(roundId), delay);
  }

  simulateCorrect(roundId = this.round?.id) {
    const r = this.round;
    if (!r || r.id !== roundId || r.phase !== 'GUESSING') return;
    const bots = shuffle(DEMO_BOTS);
    this.handleComment({ ...bots[0], comment: r.word.word, source: 'bot' });
    // Mô phỏng người xem bị trễ stream cũng gõ đúng trong cửa sổ bù trễ
    if (Math.random() < 0.6 && this.config.streamDelaySec > 0) {
      setTimeout(() => {
        if (this.round?.id === roundId) this.handleComment({ ...bots[1], comment: r.word.word, source: 'bot' });
      }, 800 + Math.random() * 1500);
    }
  }

  // ---------------------------------------------------------------- quà tặng → đổi chủ đề
  // Tên quà (chữ thường) → id chủ đề. Quà khác: chuyển sang chủ đề kế tiếp.
  giftTopicFor(giftName) {
    const name = String(giftName || '').toLowerCase();
    const map = [
      [/rose|hoa hồng/, 'session_daily'],
      [/finger heart|tim ngón/, 'session_office'],
      [/ice cream|kem/, 'session_tech'],
      [/doughnut|donut/, 'session_fnb'],
      [/hand heart|heart me|tim/, 'session_health'],
      [/tiktok$|^tiktok\b/, 'session_engineering']
    ];
    const hit = map.find(([re]) => re.test(name));
    if (hit) {
      const idx = this.topics.findIndex((t) => t.id === hit[1]);
      if (idx >= 0) return idx;
    }
    return (this.topicIdx + 1) % this.topics.length;
  }

  handleGift({ nickname, giftName }) {
    if (!this.config.giftChangesTopic || !this.topics.length) return;
    const now = Date.now();
    if (now - (this.lastGiftSwitch || 0) < this.config.giftCooldownSec * 1000) return;
    const idx = this.giftTopicFor(giftName);
    if (idx === this.topicIdx) {
      this.pushFeed('system', 'Quà tặng', `🎁 ${nickname} tặng ${giftName || 'quà'} — đang ở chủ đề này rồi!`);
      return;
    }
    this.lastGiftSwitch = now;
    this.finishRound();
    this.startTopic(idx);
    const t = this.currentTopic();
    this.pushFeed('system', 'Quà tặng', `🎁 ${nickname} tặng ${giftName || 'quà'} → đổi sang ${t.icon} ${t.title}`);
    this.emit('sfx', { type: 'success' });
  }

  // ---------------------------------------------------------------- lệnh từ host
  command(action, payload = {}) {
    switch (action) {
      case 'next':
        return this.next();
      case 'reveal':
        return this.reveal('host');
      case 'hint':
        return this.revealLetter(0.7);
      case 'board':
        if (this.round?.phase === 'GUESSING') this.reveal('host');
        return this.showBoard();
      case 'pause':
        return this.paused ? this.resume() : this.pause();
      case 'selectTopic': {
        const idx = this.topics.findIndex((t) => t.id === payload.topicId);
        if (idx >= 0) {
          this.finishRound();
          this.startTopic(idx);
        }
        return undefined;
      }
      case 'moveTopic': {
        const ids = this.topics.map((t) => t.id);
        const from = ids.indexOf(payload.topicId);
        const to = from + (payload.delta > 0 ? 1 : -1);
        if (from < 0 || to < 0 || to >= ids.length) return undefined;
        [ids[from], ids[to]] = [ids[to], ids[from]];
        return this.setConfig({ topicOrder: ids });
      }
      case 'newLive':
        return this.newLive();
      case 'resetParticipants':
        return this.resetParticipants();
      case 'resetAllTime':
        return this.resetAllTime();
      case 'simCorrect':
        return this.simulateCorrect();
      case 'setConfig':
        return this.setConfig(payload || {});
      default:
        return undefined;
    }
  }

  // ---------------------------------------------------------------- phát trạng thái
  pushFeed(type, nickname, text) {
    if (type === 'chat') {
      if (this.feedBudget < 1) return;
      this.feedBudget -= 1;
    }
    this.emit('feed', { type, nickname, text: String(text).slice(0, 120), at: Date.now() });
  }

  scheduleEmit() {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emit('state', this.snapshot());
    }, 60);
  }

  board(limit = 10) {
    return [...this.sessionBoard.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.score - a.score || b.correct - a.correct || (a.bestTimeSec ?? 99) - (b.bestTimeSec ?? 99))
      .slice(0, limit);
  }

  allTimeBoard(limit = 10) {
    const players = (this.allTimeStore.get() || { players: {} }).players;
    return Object.entries(players)
      .filter(([key, v]) => key.startsWith('u:') && v && typeof v.score === 'number')
      .map(([key, v]) => ({ key, nickname: v.nickname, score: v.score, correct: v.correct, lives: v.lives }))
      .sort((a, b) => b.score - a.score || b.correct - a.correct)
      .slice(0, limit);
  }

  snapshot() {
    const r = this.round;
    const topic = this.currentTopic();
    const word = r ? r.word : null;
    const solved = r && r.phase !== 'GUESSING';
    const letters = word ? word.word.trim() : '';

    return {
      now: Date.now(),
      paused: this.paused,
      pausedAt: this.pausedAt,
      phase: r ? r.phase : 'IDLE',
      roundId: r ? r.id : 0,
      phaseStartedAt: r ? r.phaseStartedAt : 0,
      phaseEndsAt: r ? r.endsAt : 0,
      acceptUntil: r ? r.acceptUntil : 0,
      revealReason: r ? r.revealReason : null,
      topic: topic
        ? {
            id: topic.id,
            title: topic.title,
            subtitle: topic.subtitle,
            icon: topic.icon,
            color: topic.color,
            badge: topic.badge,
            index: this.topicIdx,
            total: this.topics.length
          }
        : null,
      wordIndex: this.wordIdx + 1,
      wordCount: this.words.length,
      question: word
        ? {
            ipa: word.ipa,
            pos: word.pos,
            meaningVi: word.meaningVi,
            careerTag: word.careerTag || topic?.badge || '',
            stressHint: stressHintOf(word),
            length: letters.length,
            slots: [...letters].map((ch, i) =>
              solved || r.revealed.has(i) || !/[a-z]/i.test(ch) ? ch.toUpperCase() : null
            ),
            revealedCount: r.revealed.size
          }
        : null,
      answer: solved
        ? {
            word: word.word,
            stress: word.stress,
            meaningVi: word.meaningVi,
            usageExplanation: word.usageExplanation,
            collocations: word.collocations || [],
            exampleEn: word.exampleEn,
            exampleVi: word.exampleVi
          }
        : null,
      winners: r ? r.winners.map(({ key, isTest, ...w }) => w) : [],
      points: this.points,
      leaderboard: this.board(10).map(({ key, ...v }) => ({ ...v, justScored: !!r && r.scored.has(key) })),
      allTime: this.allTimeBoard(10),
      history: this.history.slice(0, 10),
      live: {
        id: this.live.id,
        startedAt: this.live.startedAt,
        participants: this.live.participants.size,
        maxParticipants: this.config.maxParticipants,
        dropped: this.live.dropped,
        comments: this.live.comments,
        correct: this.live.correct
      },
      topics: this.topics.map((t) => ({
        id: t.id,
        title: t.title,
        icon: t.icon,
        badge: t.badge,
        color: t.color,
        count: t.words.length
      })),
      config: this.config,
      hardware: this.hardware
    };
  }
}

module.exports = { GameEngine, DEFAULT_CONFIG };
