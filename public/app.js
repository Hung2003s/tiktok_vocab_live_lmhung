// Màn hình hiển thị + bảng điều khiển. Không giữ logic trò chơi: mọi thứ đến từ server (game:state).
(() => {
  const params = new URLSearchParams(location.search);
  const MODE = params.get('mode') === 'stream' ? 'stream' : 'host';
  if (params.get('key')) {
    localStorage.setItem('tvl_host_key', params.get('key'));
    // Xoá key khỏi thanh địa chỉ / lịch sử trình duyệt sau khi đã lưu
    params.delete('key');
    history.replaceState(null, '', `${location.pathname}${params.toString() ? `?${params}` : ''}`);
  }
  const HOST_KEY = localStorage.getItem('tvl_host_key') || '';

  const $ = (id) => document.getElementById(id);
  const el = {
    connectionLost: $('connectionLost'),
    topicIcon: $('topicIcon'),
    topicTitle: $('topicTitle'),
    topicSubtitle: $('topicSubtitle'),
    wordProgress: $('wordProgress'),
    soundToggleBtn: $('soundToggleBtn'),
    tiktokConnDot: $('tiktokConnDot'),
    tiktokConnText: $('tiktokConnText'),
    participantBadge: $('participantBadge'),
    participantText: $('participantText'),
    miniLeaderboard: $('miniLeaderboard'),
    phaseBadge: $('phaseBadge'),
    careerTag: $('careerTag'),
    timerText: $('timerText'),
    timerFill: $('timerFill'),
    quizCard: $('quizCard'),
    questionPanel: $('questionPanel'),
    ipaText: $('ipaText'),
    posText: $('posText'),
    stressText: $('stressText'),
    meaningBox: $('meaningBox'),
    meaningText: $('meaningText'),
    lengthText: $('lengthText'),
    hintStatus: $('hintStatus'),
    slotsContainer: $('slotsContainer'),
    explanationPanel: $('explanationPanel'),
    winnersBox: $('winnersBox'),
    lateWindow: $('lateWindow'),
    lateWindowSec: $('lateWindowSec'),
    usageText: $('usageText'),
    collocationsList: $('collocationsList'),
    exampleEnText: $('exampleEnText'),
    exampleViText: $('exampleViText'),
    boardPanel: $('boardPanel'),
    boardSubtitle: $('boardSubtitle'),
    podium: $('podium'),
    rankList: $('rankList'),
    allTimeStrip: $('allTimeStrip'),
    pointsText: $('pointsText'),
    chatFeed: $('chatFeed'),
    pauseBtn: $('pauseBtn'),
    topicList: $('topicList'),
    tiktokUsernameInput: $('tiktokUsernameInput'),
    connectTikTokBtn: $('connectTikTokBtn'),
    disconnectTikTokBtn: $('disconnectTikTokBtn'),
    tiktokStatusMsg: $('tiktokStatusMsg'),
    lanInfo: $('lanInfo'),
    fpsPill: $('fpsPill'),
    hwSpecs: $('hwSpecs'),
    statParticipants: $('statParticipants'),
    statDropped: $('statDropped'),
    safezoneGuide: $('safezoneGuide'),
    safezoneToggle: $('safezoneToggle'),
    confettiCanvas: $('confettiCanvas')
  };

  let state = null;
  let clockOffset = 0;
  const rendered = {}; // chữ ký các phần đã vẽ để tránh vẽ lại không cần thiết

  const escapeHtml = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const serverNow = () => Date.now() + clockOffset;

  if (MODE === 'stream') document.body.classList.add('stream-mode');

  // ================================================================ âm thanh (theo từng thiết bị)
  // Mặc định: màn hình treo live bật tiếng, máy điều khiển tắt tiếng (tránh 2 thiết bị cùng đọc).
  const SOUND_KEY = `tvl_sound_${MODE}`;
  let soundOn = localStorage.getItem(SOUND_KEY) === null ? MODE === 'stream' : localStorage.getItem(SOUND_KEY) === '1';
  let audioCtx = null;

  function unlockAudio() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    primeSpeech();
    hideAudioUnlock();
  }

  function setSound(on) {
    soundOn = on;
    localStorage.setItem(SOUND_KEY, on ? '1' : '0');
    el.soundToggleBtn.textContent = on ? '🔊' : '🔇';
    el.soundToggleBtn.classList.toggle('active', on);
    if (on) unlockAudio();
    else if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  function tone(freq, ms, type = 'sine', gain = 0.12, delay = 0) {
    if (!soundOn || !audioCtx) return;
    setTimeout(() => {
      try {
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        g.gain.setValueAtTime(gain, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + ms / 1000);
        osc.connect(g).connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + ms / 1000);
      } catch {
        /* chưa được phép phát âm */
      }
    }, delay);
  }

  const SFX = {
    success: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i === 3 ? 320 : 140, 'triangle', 0.16, i * 90)),
    reveal: () => [440, 554].forEach((f, i) => tone(f, 200, 'sine', 0.12, i * 110)),
    board: () => [587, 880].forEach((f, i) => tone(f, 200, 'triangle', 0.12, i * 100)),
    hint: () => tone(680, 90, 'sine', 0.08),
    tick: () => tone(880, 45, 'sine', 0.05)
  };

  let voices = [];
  function updateVoices() {
    if ('speechSynthesis' in window) voices = speechSynthesis.getVoices();
  }
  updateVoices();
  if ('speechSynthesis' in window) {
    speechSynthesis.onvoiceschanged = updateVoices;
  }

  function getViVoice() {
    if (!voices.length) updateVoices();
    const vi = voices.filter((v) => /^vi([-_]|$)/i.test(v.lang) || /vietnam|tiếng việt/i.test(v.name));
    // Ưu tiên giọng Siri / Nâng cao / Cao cấp nếu thiết bị có, rồi mới tới các giọng thường
    return (
      vi.find((v) => /siri/i.test(v.name)) ||
      vi.find((v) => /premium|enhanced|nâng cao|cao cấp|natural|neural/i.test(v.name)) ||
      vi.find((v) => /hoaimy|namminh|google|linh/i.test(v.name)) ||
      vi[0] ||
      null
    );
  }

  // iOS Safari: cancel() rồi speak() ngay lập tức sẽ bị câm → chỉ huỷ khi đang đọc và chờ một nhịp
  function sayNow(u) {
    try {
      speechSynthesis.resume();
      if (speechSynthesis.speaking || speechSynthesis.pending) {
        speechSynthesis.cancel();
        setTimeout(() => speechSynthesis.speak(u), 150);
      } else {
        speechSynthesis.speak(u);
      }
    } catch {
      /* bỏ qua */
    }
  }

  function speakVi(text, rate = 1.0) {
    if (!soundOn || !text || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'vi-VN';
    u.rate = rate;
    u.volume = 1;
    const v = getViVoice();
    if (v) u.voice = v;
    sayNow(u);
  }

  function speak(text, rate = 0.9) {
    if (!soundOn || !text || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = rate;
    u.volume = 1;
    u.voice =
      voices.find((v) => v.lang === 'en-US' && /natural|google|samantha|aria|jenny/i.test(v.name)) ||
      voices.find((v) => v.lang.startsWith('en')) ||
      null;
    sayNow(u);
  }

  // Trình duyệt chặn âm thanh tới khi người dùng chạm màn hình: hiện nút nhắc trên máy treo live
  let audioUnlockBtn = null;
  let speechPrimed = false;

  // Điện thoại (iOS / Android Chrome) chỉ cho đọc sau khi đã có 1 lần đọc ngay trong cú chạm của người dùng
  function primeSpeech() {
    if (speechPrimed || !('speechSynthesis' in window)) return;
    speechPrimed = true;
    try {
      speechSynthesis.cancel();
      speechSynthesis.resume();
      // Đọc ngay trong cú chạm (bắt buộc trên iPhone); lang vi-VN để iOS tự chọn giọng Việt (Linh)
      const u = new SpeechSynthesisUtterance('Đã bật âm thanh');
      u.lang = 'vi-VN';
      u.volume = 1;
      const v = getViVoice();
      if (v) u.voice = v;
      speechSynthesis.speak(u);
      // iOS nạp danh sách giọng chậm: kiểm tra lại sau 1.5 giây rồi mới báo thiếu giọng
      setTimeout(() => {
        updateVoices();
        if (!getViVoice()) showAudioNote('⚠️ Không tìm thấy giọng tiếng Việt. iPhone: Cài đặt → Trợ năng → Nội dung được đọc → Giọng nói → Tiếng Việt → tải "Linh". Android: cài Google Text-to-speech + gói tiếng Việt.');
      }, 1500);
    } catch {
      /* bỏ qua */
    }
  }

  function showAudioNote(msg) {
    const note = document.createElement('div');
    note.className = 'audio-note';
    note.textContent = msg;
    note.addEventListener('click', () => note.remove());
    document.body.appendChild(note);
    setTimeout(() => note.remove(), 15000);
  }

  function showAudioUnlock() {
    if (audioUnlockBtn || !soundOn) return;
    audioUnlockBtn = document.createElement('button');
    audioUnlockBtn.className = 'audio-unlock-btn';
    audioUnlockBtn.textContent = '🔊 Chạm một lần để bật âm thanh';
    audioUnlockBtn.addEventListener('click', unlockAudio);
    document.body.appendChild(audioUnlockBtn);
  }
  function hideAudioUnlock() {
    if (audioUnlockBtn) audioUnlockBtn.remove();
    audioUnlockBtn = null;
  }
  ['click', 'touchend'].forEach((evt) =>
    document.addEventListener(evt, () => { if (soundOn) unlockAudio(); }, { once: true, passive: true })
  );

  // ================================================================ kết nối server
  const socket = io({ auth: { key: HOST_KEY } });

  socket.on('connect', () => el.connectionLost.classList.add('hidden'));
  socket.on('disconnect', () => el.connectionLost.classList.remove('hidden'));
  socket.on('game:error', (msg) => alert(msg));
  // Thiết bị không có quyền điều khiển → tự chuyển sang chế độ chỉ xem
  socket.on('game:hello', ({ isHost }) => {
    if (!isHost) {
      document.body.classList.add('stream-mode');
      // Thiết bị chỉ xem (điện thoại qua Wi-Fi / Tailscale): mặc định bật tiếng nếu chưa từng chọn
      if (localStorage.getItem(SOUND_KEY) === null) {
        soundOn = true;
        showAudioUnlock();
      }
    }
  });

  socket.on('game:state', (next) => {
    clockOffset = next.now - Date.now();
    const prev = state;
    state = next;
    render(prev, next);
  });

  socket.on('game:feed', addFeed);
  socket.on('game:speak', ({ text, rate }) => speak(text, rate));
  socket.on('game:sfx', ({ type }) => SFX[type] && SFX[type]());

  const cmd = (action, payload) => socket.emit('host:cmd', { action, payload });

  // ================================================================ vẽ giao diện
  function once(key, signature, fn) {
    if (rendered[key] === signature) return;
    rendered[key] = signature;
    fn();
  }

  function render(prev, s) {
    if (!s.topic || !s.question) return;
    document.documentElement.style.setProperty('--session-color', s.topic.color || '#10b981');

    el.topicIcon.textContent = s.topic.icon;
    el.topicTitle.textContent = s.topic.title;
    el.topicSubtitle.textContent = `Chủ đề ${s.topic.index + 1}/${s.topic.total} • ${s.topic.badge}`;
    el.wordProgress.textContent = `${s.wordIndex}/${s.wordCount}`;
    el.careerTag.textContent = s.question.careerTag;
    el.pointsText.textContent = s.points.join('/');

    // Tắt "đổi chủ đề khi donate" thì ẩn bảng quà và dòng luật chơi liên quan
    const giftOn = s.config?.giftChangesTopic !== false;
    ['giftBar', 'giftRuleLine'].forEach((id) => $(id)?.classList.toggle('hidden', !giftOn));

    renderParticipants(s);
    renderMiniBoard(s);
    renderPhase(s);
    renderQuestion(s);
    renderExplanation(s);
    if (s.phase === 'LEADERBOARD') renderBoard(s);
    renderTikTok(s);
    renderHostPanels(s);

    // Pháo hoa khi có người đầu tiên trả lời đúng
    if (s.winners.length && (!prev || prev.roundId !== s.roundId || !prev.winners.length)) fireConfetti();
  }

  function renderPhase(s) {
    const badge = {
      GUESSING: ['⏳ ĐANG ĐOÁN TỪ', ''],
      REVEAL: ['✨ ĐÁP ÁN & CÁCH DÙNG', 'explaining'],
      LEADERBOARD: ['🏆 BẢNG XẾP HẠNG', 'leaderboard']
    }[s.phase] || ['…', ''];
    el.phaseBadge.textContent = s.paused ? '⏸️ TẠM DỪNG' : badge[0];
    el.phaseBadge.className = `phase-badge ${badge[1]}`;
    el.quizCard.classList.toggle('success-state', s.phase === 'REVEAL');
    el.quizCard.classList.toggle('leaderboard-state', s.phase === 'LEADERBOARD');
    el.quizCard.classList.toggle('paused-state', s.paused);
    el.questionPanel.classList.toggle('hidden', s.phase === 'LEADERBOARD');
    el.boardPanel.classList.toggle('hidden', s.phase !== 'LEADERBOARD');
    const guessPrompt = $('streamGuessPrompt');
    if (guessPrompt) guessPrompt.classList.toggle('hidden', s.phase !== 'GUESSING');
    el.pauseBtn.textContent = s.paused ? '▶️ Tiếp' : '⏸️ Dừng';
  }

  function renderQuestion(s) {
    const q = s.question;
    once('question', `${s.roundId}|${s.phase === 'GUESSING'}`, () => {
      el.ipaText.textContent = q.ipa;
      el.posText.textContent = q.pos;
      el.meaningText.textContent = q.meaningVi;
      el.lengthText.textContent = `Từ gồm ${q.slots.filter((c) => c !== ' ').length} chữ cái`;
      // Lúc đoán chỉ gợi ý vị trí trọng âm; phiên âm đọc bồi (con-VE-nient) lộ đáp án nên để sau
      el.stressText.textContent =
        s.phase === 'GUESSING' ? (q.stressHint ? `💡 ${q.stressHint}` : '') : `🗣️ ${s.answer?.stress || ''}`;
      el.meaningBox.classList.toggle('hidden', s.phase !== 'GUESSING');

      // Tự động phát âm giọng tiếng Việt đọc gợi ý mỗi lần hiển thị câu hỏi mới
      if (s.phase === 'GUESSING' && q.meaningVi) {
        const cleanMeaning = q.meaningVi.replace(/\([^)]*\)/g, '').trim();
        const lettersCount = q.slots.filter((c) => c !== ' ').length;
        const firstLetter = q.slots[0];
        const letterHint = firstLetter ? `, bắt đầu bằng chữ ${firstLetter}` : '';
        speakVi(`Gợi ý: ${cleanMeaning}. Từ gồm ${lettersCount} chữ cái${letterHint}.`);
      }
    });

    once('slots', `${s.roundId}|${q.slots.join(',')}`, () => {
      const long = q.slots.length >= 10;
      const solved = s.phase !== 'GUESSING';
      el.slotsContainer.innerHTML = '';
      q.slots.forEach((ch) => {
        const d = document.createElement('div');
        d.className = `letter-slot${long ? ' long-word' : ''}${solved ? ' solved' : ch ? ' hint-revealed' : ''}`;
        d.textContent = ch || '_';
        el.slotsContainer.appendChild(d);
      });
      const letters = q.slots.filter((c) => c && c !== ' ' && c !== '-').length;
      el.hintStatus.textContent = solved
        ? `✅ ${s.answer.word.toUpperCase()}`
        : `Gợi ý: ${letters}/${q.slots.filter((c) => c !== ' ').length} chữ`;
    });
  }

  function renderExplanation(s) {
    const show = s.phase === 'REVEAL';
    el.explanationPanel.classList.toggle('hidden', !show);
    if (!show) return;

    once('winners', `${s.roundId}|${s.winners.length}|${s.revealReason}`, () => {
      if (!s.winners.length) {
        el.winnersBox.innerHTML = `<div class="winner-row no-winner"><span class="winner-name">💡 Đáp án: ${escapeHtml(
          s.answer.word.toUpperCase()
        )}</span><span class="winner-meta">${escapeHtml(s.answer.meaningVi)}</span></div>`;
        return;
      }
      const medals = ['🥇', '🥈', '🥉', '🏅', '🏅'];
      el.winnersBox.innerHTML = s.winners
        .slice(0, 5)
        .map(
          (w) => `<div class="winner-row rank-${w.rank}">
            <span class="winner-name">${medals[w.rank - 1] || '✅'} @${escapeHtml(w.nickname)}${w.exact ? '' : ' <small>(gần đúng)</small>'}</span>
            <span class="winner-meta">+${w.points}đ<small>${w.timeSec}s</small></span>
          </div>`
        )
        .join('');
      if (s.winners.length > 5) {
        el.winnersBox.insertAdjacentHTML(
          'beforeend',
          `<div class="winner-row"><span class="winner-name">+${s.winners.length - 5} bạn khác cũng đúng</span></div>`
        );
      }
    });

    once('explain', `${s.roundId}`, () => {
      el.usageText.textContent = s.answer.usageExplanation;
      el.collocationsList.innerHTML = '';
      s.answer.collocations.forEach((c) => {
        const span = document.createElement('span');
        span.className = 'collocation-tag';
        span.textContent = c;
        el.collocationsList.appendChild(span);
      });
      el.exampleEnText.textContent = s.answer.exampleEn ? `"${s.answer.exampleEn}"` : '';
      el.exampleViText.textContent = s.answer.exampleVi ? `→ ${s.answer.exampleVi}` : '';
    });
  }

  function renderBoard(s) {
    const board = s.leaderboard;
    const last = s.history[0];
    const winnerNames = last && last.winners.length ? last.winners.map((w) => '@' + w.nickname).join(', ') : 'không ai';
    el.boardSubtitle.textContent = last
      ? `Câu vừa rồi "${last.word.toUpperCase()}": ${winnerNames} • ${s.live.participants} người chơi`
      : `${s.live.participants} người chơi`;

    once('board', JSON.stringify(board), () => {
      if (!board.length) {
        el.podium.innerHTML = '';
        el.rankList.innerHTML = `<div class="lbs-empty-box">🏆 Chưa ai ghi điểm. Comment đáp án đúng ở câu tiếp theo để lên Top 1!</div>`;
        return;
      }
      const slot = (u, rank, medal) =>
        u
          ? `<div class="podium-card rank-${rank}">
              ${u.justScored ? '<span class="just-scored-badge">⬆️</span>' : ''}
              <div class="podium-medal">${medal}</div>
              <div class="podium-name">@${escapeHtml(u.nickname)}</div>
              <div class="podium-score">${u.score} điểm</div>
              <div class="podium-meta">Đúng ${u.correct} câu${u.streak >= 2 ? ` • 🔥x${u.streak}` : ''}</div>
            </div>`
          : `<div class="podium-card rank-${rank}" style="opacity:.4"><div class="podium-medal">${medal}</div><div class="podium-name">Còn trống</div></div>`;
      el.podium.innerHTML = slot(board[1], 2, '🥈') + slot(board[0], 1, '👑') + slot(board[2], 3, '🥉');
      el.rankList.innerHTML = board
        .slice(3, 7)
        .map(
          (u, i) => `<div class="lbs-rank-row ${u.justScored ? 'just-scored-row' : ''}">
            <div class="lbs-rank-left"><span class="lbs-rank-num">#${i + 4}</span><span class="lbs-rank-name">@${escapeHtml(u.nickname)}${
            u.streak >= 2 ? ` 🔥x${u.streak}` : ''
          }</span></div>
            <div class="lbs-rank-right"><span class="lbs-rank-words">${u.correct} câu</span><span class="lbs-rank-pts">${u.score}đ</span></div>
          </div>`
        )
        .join('');
    });

    const champ = s.allTime[0];
    el.allTimeStrip.innerHTML = champ
      ? `👑 Vua từ vựng mọi phiên: <strong>@${escapeHtml(champ.nickname)}</strong> — ${champ.score}đ qua ${champ.lives} phiên`
      : 'Điểm được cộng dồn qua các phiên live — quay lại để giữ hạng!';
  }

  function renderParticipants(s) {
    const { participants, maxParticipants } = s.live;
    el.participantText.textContent = `${participants}/${maxParticipants}`;
    el.participantBadge.classList.toggle('is-full', participants >= maxParticipants);
    el.participantBadge.classList.toggle('near-full', participants < maxParticipants && participants >= maxParticipants * 0.8);
  }

  function renderMiniBoard(s) {
    once('mini', JSON.stringify(s.leaderboard.slice(0, 5).map((u) => [u.nickname, u.score])), () => {
      el.miniLeaderboard.innerHTML = s.leaderboard.length
        ? s.leaderboard
            .slice(0, 2)
            .map((u, i) => `<span class="lb-pill">${['🥇', '🥈'][i]} ${escapeHtml(u.nickname)} ${u.score}</span>`)
            .join('')
        : '<span class="lb-pill">🏆 BXH</span>';

      const sList = $('streamLeaderboardList');
      if (sList) {
        const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
        if (!s.leaderboard.length) {
          sList.innerHTML = '<div class="feed-empty-tip">Chưa ai có điểm, hãy comment nhanh!</div>';
        } else {
          sList.innerHTML = s.leaderboard.slice(0, 5).map((u, i) => `
            <div class="stream-leader-row">
              <span class="sl-rank">${medals[i] || `${i + 1}.`}</span>
              <span class="sl-name">@${escapeHtml(u.nickname)}</span>
              <span class="sl-score">${u.score}đ</span>
            </div>
          `).join('');
        }
      }
    });
  }

  function renderTikTok(s) {
    const t = s.tiktok || {};
    el.tiktokConnDot.className = `conn-dot ${t.status === 'connected' ? 'connected' : t.status === 'connecting' ? 'connecting' : ''}`;
    el.tiktokConnText.textContent =
      t.status === 'connected' ? `@${t.username}${t.viewerCount ? ` 👁 ${t.viewerCount}` : ''}` : t.status === 'connecting' ? 'Đang nối…' : 'TikTok';
    el.tiktokStatusMsg.textContent = t.message || '';
    const connected = t.status === 'connected' || t.status === 'connecting';
    el.connectTikTokBtn.classList.toggle('hidden', connected);
    el.disconnectTikTokBtn.classList.toggle('hidden', !connected);
  }

  // ================================================================ đồng hồ (tính từ mốc thời gian server)
  let lastTickSecond = -1;
  setInterval(() => {
    if (!state || !state.phaseEndsAt) return;
    const now = state.paused ? state.pausedAt : serverNow();
    const remainMs = Math.max(0, state.phaseEndsAt - now);
    const totalMs = Math.max(1, state.phaseEndsAt - state.phaseStartedAt);
    const sec = Math.ceil(remainMs / 1000);

    el.timerText.textContent = `${sec}s`;
    el.timerFill.style.width = `${(remainMs / totalMs) * 100}%`;
    el.timerFill.classList.toggle('urgent', state.phase === 'GUESSING' && sec <= 5);
    el.timerFill.classList.toggle('explaining', state.phase === 'REVEAL');
    el.timerFill.classList.toggle('leaderboard', state.phase === 'LEADERBOARD');

    if (state.phase === 'GUESSING' && sec <= 5 && sec > 0 && sec !== lastTickSecond && !state.paused) SFX.tick();
    lastTickSecond = sec;

    const lateMs = state.phase === 'REVEAL' ? state.acceptUntil - now : 0;
    el.lateWindow.classList.toggle('hidden', lateMs <= 0);
    if (lateMs > 0) el.lateWindowSec.textContent = Math.ceil(lateMs / 1000);
  }, 200);

  // ================================================================ feed comment & trực tiếp nhận đáp án
  function addFeed(item) {
    if (el.chatFeed) {
      const row = document.createElement('div');
      row.className = `chat-feed-item${item.type === 'correct' ? ' correct-chat' : ''}`;
      const a = document.createElement('span');
      a.className = 'chat-author';
      a.textContent = item.type === 'system' ? '🤖 Hệ thống:' : `${item.nickname}:`;
      const t = document.createElement('span');
      t.className = 'chat-text';
      t.textContent = item.text;
      row.append(a, t);
      el.chatFeed.appendChild(row);
      const max = document.body.classList.contains('eco-hardware-mode') ? 8 : 16;
      while (el.chatFeed.children.length > max) el.chatFeed.firstChild.remove();
      el.chatFeed.scrollTop = el.chatFeed.scrollHeight;
    }

    const streamFeed = $('streamLiveFeed');
    if (streamFeed) {
      const tip = streamFeed.querySelector('.feed-empty-tip');
      if (tip) tip.remove();
      const row = document.createElement('div');
      row.className = `stream-feed-item${item.type === 'correct' ? ' correct-feed' : ''}`;
      row.innerHTML = `<span class="sf-user">@${escapeHtml(item.nickname)}:</span> <span class="sf-msg">${escapeHtml(item.text)}</span>`;
      streamFeed.appendChild(row);
      while (streamFeed.children.length > 5) streamFeed.firstChild.remove();
      streamFeed.scrollTop = streamFeed.scrollHeight;
    }
  }

  // ================================================================ bảng điều khiển host
  const LABELS = {
    guessSec: (v) => `${v} giây`,
    explainSec: (v) => `${v} giây`,
    leaderboardSec: (v) => (v ? `${v} giây` : 'Bỏ qua'),
    streamDelaySec: (v) => (v ? `${v} giây` : 'Tắt'),
    maxWinners: (v) => `${v} người (${[10, 7, 5, 3, 2].slice(0, v).join('/')}đ)`,
    perUserCooldownMs: (v) => (v ? `${(v / 1000).toFixed(v % 1000 ? 2 : 0)} giây` : 'Tắt'),
    maxParticipants: (v) => `${v} người`,
    giftCooldownSec: (v) => (v ? `${v} giây` : 'Không chờ')
  };

  function renderHostPanels(s) {
    if (MODE === 'stream') return;
    const cfg = s.config;

    document.querySelectorAll('[data-config]').forEach((input) => {
      const key = input.dataset.config;
      if (document.activeElement === input) return;
      if (input.type === 'checkbox') input.checked = Boolean(cfg[key]);
      else input.value = cfg[key];
    });
    document.querySelectorAll('[data-label]').forEach((label) => {
      const key = label.dataset.label;
      label.textContent = LABELS[key] ? LABELS[key](cfg[key]) : cfg[key];
    });
    document.querySelectorAll('.hw-preset-btn').forEach((b) => b.classList.toggle('active', Number(b.dataset.cap) === cfg.maxParticipants));

    el.statParticipants.textContent = `${s.live.participants}/${s.live.maxParticipants}`;
    el.statDropped.textContent = s.live.dropped;

    const hw = s.hardware;
    once('hw', JSON.stringify(hw), () => {
      el.hwSpecs.innerHTML = `Máy chạy server: <strong>${hw.cpuCount} luồng CPU</strong>, <strong>RAM ${hw.totalRamGB}GB</strong> (${escapeHtml(
        hw.tierName
      )}).<br/>Đo thực tế: chấm được <strong>~${hw.judgedPerSec.toLocaleString('vi-VN')} comment/giây</strong> — gợi ý tối đa <strong>${
        hw.recommendedMaxParticipants
      } người/phiên</strong>.`;
    });

    once('topics', JSON.stringify([s.topics, s.topic.id]), () => {
      el.topicList.innerHTML = '';
      s.topics.forEach((t, i) => {
        const card = document.createElement('div');
        card.className = `session-card-item${t.id === s.topic.id ? ' active' : ''}`;
        card.innerHTML = `
          <div class="session-card-left">
            <span class="session-card-icon">${t.icon}</span>
            <div class="session-card-info"><h4>${i + 1}. ${escapeHtml(t.title)}</h4><p>${escapeHtml(t.badge)} • ${t.count} từ</p></div>
          </div>
          <div class="session-card-controls">
            <button class="order-btn" data-move="-1" ${i === 0 ? 'disabled' : ''}>▲</button>
            <button class="order-btn" data-move="1" ${i === s.topics.length - 1 ? 'disabled' : ''}>▼</button>
            <button class="play-session-btn">${t.id === s.topic.id ? 'Đang phát' : 'Phát'}</button>
          </div>`;
        card.querySelectorAll('[data-move]').forEach((b) =>
          b.addEventListener('click', () => cmd('moveTopic', { topicId: t.id, delta: Number(b.dataset.move) }))
        );
        card.querySelector('.play-session-btn').addEventListener('click', () => {
          cmd('selectTopic', { topicId: t.id });
          $('topicModal').classList.add('hidden');
        });
        el.topicList.appendChild(card);
      });
    });
  }

  function bindHostControls() {
    document.querySelectorAll('[data-cmd]').forEach((btn) =>
      btn.addEventListener('click', () => {
        if (btn.id === 'previewStreamBtn') return;
        if (btn.dataset.confirm && !confirm(btn.dataset.confirm)) return;
        cmd(btn.dataset.cmd);
      })
    );

    document.querySelectorAll('[data-config]').forEach((input) => {
      const key = input.dataset.config;
      if (input.type === 'checkbox') {
        input.addEventListener('change', () => cmd('setConfig', { [key]: input.checked }));
      } else {
        input.addEventListener('input', () => {
          const label = document.querySelector(`[data-label="${key}"]`);
          if (label && LABELS[key]) label.textContent = LABELS[key](Number(input.value));
        });
        input.addEventListener('change', () => cmd('setConfig', { [key]: Number(input.value) }));
      }
    });

    document.querySelectorAll('.hw-preset-btn').forEach((b) =>
      b.addEventListener('click', () => cmd('setConfig', { maxParticipants: Number(b.dataset.cap) }))
    );

    const open = (id) => () => $(id).classList.remove('hidden');
    $('openTopicModalBtn').addEventListener('click', () => MODE === 'host' && open('topicModal')());
    $('openTikTokModalBtn').addEventListener('click', open('tiktokModal'));
    $('openSettingsModalBtn').addEventListener('click', open('settingsModal'));
    el.participantBadge.addEventListener('click', () => MODE === 'host' && open('settingsModal')());
    document.querySelectorAll('[data-close]').forEach((b) =>
      b.addEventListener('click', () => $(b.dataset.close).classList.add('hidden'))
    );
    document.querySelectorAll('.modal-backdrop').forEach((m) =>
      m.addEventListener('click', (e) => e.target === m && m.classList.add('hidden'))
    );

    el.soundToggleBtn.addEventListener('click', () => setSound(!soundOn));
    $('speakMeaningBtn')?.addEventListener('click', () => {
      if (state?.question?.meaningVi) {
        unlockAudio();
        const q = state.question;
        const cleanMeaning = q.meaningVi.replace(/\([^)]*\)/g, '').trim();
        const lettersCount = q.slots.filter((c) => c !== ' ').length;
        const firstLetter = q.slots[0];
        const letterHint = firstLetter ? `, bắt đầu bằng chữ ${firstLetter}` : '';
        speakVi(`Gợi ý: ${cleanMeaning}. Từ gồm ${lettersCount} chữ cái${letterHint}.`);
      }
    });
    $('speakWordBtn')?.addEventListener('click', () => {
      // Server không gửi đáp án trong lúc đoán (tránh lộ qua DevTools) → chỉ nghe lại sau khi mở đáp án
      if (!state?.answer) {
        $('speakWordBtn').title = 'Gợi ý phát âm tự phát ở 35% thời gian; nghe lại được sau khi mở đáp án';
        return;
      }
      unlockAudio();
      const was = soundOn;
      soundOn = true;
      speak(state.answer.word, 0.85);
      soundOn = was;
    });
    $('speakExampleBtn').addEventListener('click', () => {
      unlockAudio();
      const was = soundOn;
      soundOn = true;
      speak(state?.answer?.exampleEn, 0.9);
      soundOn = was;
    });

    $('answerForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('answerInput');
      if (!input.value.trim()) return;
      socket.emit('host:answer', { comment: input.value.trim() });
      input.value = '';
    });

    el.connectTikTokBtn.addEventListener('click', () => {
      const username = el.tiktokUsernameInput.value.trim();
      localStorage.setItem('tvl_tiktok_user', username);
      socket.emit('tiktok:connect', { username });
    });
    el.disconnectTikTokBtn.addEventListener('click', () => socket.emit('tiktok:disconnect'));
    el.tiktokUsernameInput.value = localStorage.getItem('tvl_tiktok_user') || '';

    $('importForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const out = $('importResult');
      out.textContent = 'Đang nhập...';
      try {
        const res = await fetch('/api/words', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-host-key': HOST_KEY },
          body: JSON.stringify({ topicId: state.topic.id, content: $('importText').value })
        });
        const data = await res.json();
        if (!res.ok) throw new Error([data.error, ...(data.errors || [])].join(' • '));
        out.textContent = `✅ Đã thêm ${data.added} từ${data.skipped.length ? `, bỏ qua ${data.skipped.length} từ trùng` : ''}${
          data.errors.length ? ` • Lỗi: ${data.errors.join(' • ')}` : ''
        }`;
        if (data.added) $('importText').value = '';
      } catch (err) {
        out.textContent = `❌ ${err.message}`;
      }
    });

    el.safezoneToggle.checked = localStorage.getItem('tvl_safezone') === '1';
    el.safezoneGuide.classList.toggle('hidden', !el.safezoneToggle.checked);
    el.safezoneToggle.addEventListener('change', () => {
      localStorage.setItem('tvl_safezone', el.safezoneToggle.checked ? '1' : '0');
      el.safezoneGuide.classList.toggle('hidden', !el.safezoneToggle.checked);
    });

    // Xem trước đúng giao diện người xem TikTok sẽ thấy
    $('previewStreamBtn').addEventListener('click', () => {
      document.body.classList.add('stream-mode');
      const exit = document.createElement('button');
      exit.className = 'stream-preview-exit-btn';
      exit.textContent = '✕ Thoát xem trước';
      exit.title = 'Trở về màn hình điều khiển Host';
      exit.addEventListener('click', () => {
        document.body.classList.remove('stream-mode');
        exit.remove();
      });
      document.body.appendChild(exit);
    });

    fetch('/api/info')
      .then((r) => r.json())
      .then((info) => {
        const ip = info.lanIps[0] || 'IP-may-tinh';
        const keyPart = info.hostKeyRequired ? '<br/>🔒 Server đang bật HOST_KEY: thêm <code>?key=...</code> vào URL điều khiển.' : '';
        el.lanInfo.innerHTML = `
          1️⃣ Điện thoại treo live (cùng Wi-Fi): <strong style="color:#38bdf8">http://${ip}:${info.port}/?mode=stream</strong> → mở TikTok, chọn phát live chia sẻ màn hình.<br/>
          2️⃣ Máy tính này giữ trang điều khiển để kết nối TikTok, chỉnh cài đặt, bấm câu tiếp.<br/>
          3️⃣ Trang BXH riêng: <a href="/bxh" target="_blank" style="color:#fde047">http://${ip}:${info.port}/bxh</a>${keyPart}`;
      })
      .catch(() => {});
  }

  // ================================================================ hiệu năng: chỉ giảm hiệu ứng khi FPS thấp
  (function monitorFps() {
    let frames = 0;
    let last = performance.now();
    let lowStreak = 0;
    function loop(now) {
      frames += 1;
      if (now - last >= 2000) {
        const fps = Math.min(60, Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
        if (el.fpsPill) el.fpsPill.textContent = `⚡ ${fps} FPS`;
        if (!document.hidden) {
          lowStreak = fps < 35 ? lowStreak + 1 : 0;
          if (lowStreak >= 2) document.body.classList.add('eco-hardware-mode');
        }
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  })();

  // ================================================================ pháo hoa
  const particles = [];
  let animId = null;
  function fireConfetti() {
    const c = el.confettiCanvas;
    c.width = c.clientWidth;
    c.height = c.clientHeight;
    const n = document.body.classList.contains('eco-hardware-mode') ? 12 : 40;
    const colors = ['#10b981', '#38bdf8', '#fde047', '#f43f5e', '#a855f7'];
    for (let i = 0; i < n; i++) {
      particles.push({
        x: c.width / 2,
        y: c.height * 0.35,
        vx: (Math.random() - 0.5) * 9,
        vy: (Math.random() - 0.85) * 9,
        s: 5 + Math.random() * 5,
        color: colors[i % colors.length],
        a: 1
      });
    }
    if (!animId) animate();
  }
  function animate() {
    const c = el.confettiCanvas;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.22;
      p.a -= 0.02;
      if (p.a <= 0) {
        particles.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = p.a;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.s, p.s);
    }
    ctx.globalAlpha = 1;
    animId = particles.length ? requestAnimationFrame(animate) : null;
  }

  // ================================================================ khởi chạy
  setSound(soundOn);
  if (MODE === 'stream' && soundOn) showAudioUnlock();
  bindHostControls();
})();
