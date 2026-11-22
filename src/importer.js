// Nhập từ vựng hàng loạt từ JSON hoặc CSV (dòng đầu là tiêu đề cột).

const FIELD_ALIASES = {
  word: ['word', 'tu', 'từ', 'english'],
  ipa: ['ipa', 'phienam', 'phiên âm', 'phonetic'],
  pos: ['pos', 'tuloai', 'từ loại', 'type'],
  stress: ['stress', 'trongam', 'trọng âm'],
  meaningVi: ['meaningvi', 'meaning', 'nghia', 'nghĩa', 'vi'],
  usageExplanation: ['usageexplanation', 'usage', 'giaithich', 'giải thích', 'cachdung', 'cách dùng'],
  collocations: ['collocations', 'cumtu', 'cụm từ'],
  exampleEn: ['exampleen', 'example', 'vidu', 'ví dụ'],
  exampleVi: ['examplevi', 'dichvidu', 'dịch ví dụ'],
  careerTag: ['careertag', 'tag', 'nganh', 'ngành']
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',' || ch === '\t') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

function headerToField(header) {
  const h = header.trim().toLowerCase().replace(/[\s_]/g, '');
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.some((a) => a.replace(/\s/g, '') === h)) return field;
  }
  return null;
}

function normalizeWord(raw) {
  const word = String(raw.word || '').trim().toLowerCase();
  const ipa = String(raw.ipa || '').trim();
  const meaningVi = String(raw.meaningVi || '').trim();
  if (!/^[a-z][a-z' -]{0,40}$/.test(word)) throw new Error(`Từ không hợp lệ: "${raw.word || ''}"`);
  if (!ipa) throw new Error(`Thiếu phiên âm IPA cho "${word}"`);
  if (!meaningVi) throw new Error(`Thiếu nghĩa tiếng Việt cho "${word}"`);
  if (meaningVi.toLowerCase().includes(word)) throw new Error(`Nghĩa của "${word}" đang chứa luôn đáp án`);

  let collocations = raw.collocations || [];
  if (typeof collocations === 'string') collocations = collocations.split(/[|;]/);
  collocations = collocations.map((c) => String(c).trim()).filter(Boolean).slice(0, 6);

  return {
    word,
    ipa: ipa.startsWith('/') ? ipa : `/${ipa}/`,
    pos: String(raw.pos || 'Từ vựng').trim(),
    stress: String(raw.stress || '').trim(),
    meaningVi,
    careerTag: String(raw.careerTag || '').trim(),
    usageExplanation: String(raw.usageExplanation || '').trim() || 'Từ vựng thông dụng trong công việc và đời sống.',
    collocations,
    exampleEn: String(raw.exampleEn || '').trim(),
    exampleVi: String(raw.exampleVi || '').trim()
  };
}

/** @returns {{ words: object[], errors: string[] }} */
function parseImport(input) {
  let records = [];
  if (Array.isArray(input)) {
    records = input;
  } else {
    const text = String(input || '').trim();
    if (!text) return { words: [], errors: ['Nội dung trống'] };
    if (text.startsWith('[') || text.startsWith('{')) {
      const parsed = JSON.parse(text);
      records = Array.isArray(parsed) ? parsed : [parsed];
    } else {
      const rows = parseCsv(text);
      const fields = rows[0].map(headerToField);
      if (!fields.includes('word')) {
        return { words: [], errors: ['CSV cần dòng tiêu đề, tối thiểu: word,ipa,meaningVi'] };
      }
      records = rows.slice(1).map((cells) => {
        const rec = {};
        fields.forEach((f, i) => {
          if (f) rec[f] = cells[i] || '';
        });
        return rec;
      });
    }
  }

  const words = [];
  const errors = [];
  records.forEach((rec, i) => {
    try {
      words.push(normalizeWord(rec));
    } catch (err) {
      errors.push(`Dòng ${i + 1}: ${err.message}`);
    }
  });
  return { words, errors };
}

module.exports = { parseImport };
