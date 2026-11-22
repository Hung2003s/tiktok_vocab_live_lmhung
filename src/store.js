// Lưu trữ JSON đơn giản trên đĩa, ghi trễ (debounce) để không chặn vòng lặp sự kiện.
const fs = require('fs');
const path = require('path');

class JsonStore {
  constructor(filePath, fallback) {
    this.filePath = filePath;
    this.timer = null;
    this.data = fallback;
    try {
      if (fs.existsSync(filePath)) {
        this.data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    } catch (err) {
      console.warn(`[store] Không đọc được ${path.basename(filePath)}, dùng giá trị mặc định:`, err.message);
    }
  }

  get() {
    return this.data;
  }

  set(value) {
    this.data = value;
    this.save();
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 1000);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      console.error(`[store] Lỗi ghi ${path.basename(this.filePath)}:`, err.message);
    }
  }
}

module.exports = { JsonStore };
