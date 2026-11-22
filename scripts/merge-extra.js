// Gộp data/extra/<topicId>.json vào data/vocabulary.json (kiểm tra trùng / lộ đáp án / thiếu trường).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const vocabFile = path.join(root, 'data', 'vocabulary.json');
const v = JSON.parse(fs.readFileSync(vocabFile, 'utf8'));
const prefix = { session_daily: 'dl', session_office: 'of', session_tech: 'it', session_fnb: 'fb', session_health: 'hl', session_engineering: 'en' };
const seen = new Set(v.flatMap((t) => t.words.map((w) => w.word.toLowerCase())));
const required = ['word', 'ipa', 'stress', 'pos', 'meaningVi', 'usageExplanation', 'exampleEn', 'exampleVi'];

for (const t of v) {
  const file = path.join(root, 'data', 'extra', `${t.id}.json`);
  if (!fs.existsSync(file)) continue;
  let added = 0;
  const skipped = [];
  for (const w of JSON.parse(fs.readFileSync(file, 'utf8'))) {
    const k = String(w.word || '').toLowerCase().trim();
    const bad =
      required.some((r) => typeof w[r] !== 'string' || !w[r].trim()) ||
      !/^[a-z]{4,14}$/.test(k) ||
      seen.has(k) ||
      w.meaningVi.toLowerCase().includes(k) ||
      !Array.isArray(w.collocations);
    if (bad) {
      skipped.push(k);
      continue;
    }
    seen.add(k);
    added += 1;
    t.words.push({ ...w, word: k, id: `${prefix[t.id]}_x${added}`, careerTag: w.careerTag || t.badge });
  }
  console.log(t.id, 'thêm', added, 'bỏ qua', skipped.join(',') || '-', 'tổng', t.words.length);
}
fs.writeFileSync(vocabFile, JSON.stringify(v, null, 2));
