// Chấm đáp án từ comment TikTok: chuẩn hoá, tách token, cho phép sai 1 ký tự với từ dài.

function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function tokenize(text) {
  return normalize(text)
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// Levenshtein có ngưỡng dừng sớm (chỉ cần biết <= max hay không)
function withinDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

const MAX_TOKENS = 12; // comment quá dài gần như chắc chắn không phải câu trả lời
const TYPO_MIN_LENGTH = 8; // chỉ chấp nhận sai chính tả nhẹ với từ >= 8 chữ cái

/**
 * @returns {{ ok: boolean, exact: boolean }}
 */
function matchAnswer(comment, target) {
  const answer = normalize(target);
  if (!answer) return { ok: false, exact: false };

  const tokens = tokenize(comment);
  if (tokens.length === 0 || tokens.length > MAX_TOKENS) return { ok: false, exact: false };

  const joined = ` ${tokens.join(' ')} `;
  if (answer.includes(' ')) {
    return joined.includes(` ${answer} `) ? { ok: true, exact: true } : { ok: false, exact: false };
  }

  if (tokens.includes(answer)) return { ok: true, exact: true };

  if (answer.length >= TYPO_MIN_LENGTH) {
    const near = tokens.some((t) => t.length >= TYPO_MIN_LENGTH - 1 && withinDistance(t, answer, 1));
    if (near) return { ok: true, exact: false };
  }
  return { ok: false, exact: false };
}

module.exports = { matchAnswer, normalize };
