// Đánh giá phần cứng máy chạy server để đề xuất giới hạn người tham gia mỗi phiên live.
const os = require('os');

function getHardwareProfile() {
  const cpus = os.cpus() || [];
  const cpuCount = cpus.length || 2;
  const totalRamGB = Math.round((os.totalmem() / 1024 ** 3) * 10) / 10;
  const freeRamGB = Math.round((os.freemem() / 1024 ** 3) * 10) / 10;

  let tier = 'medium';
  let tierName = 'Cân bằng';
  let recommendedMaxParticipants = 300;

  if (cpuCount <= 4 || totalRamGB <= 4.5) {
    tier = 'low';
    tierName = 'Máy yếu';
    recommendedMaxParticipants = 100;
  } else if (cpuCount >= 8 && totalRamGB >= 12) {
    tier = 'high';
    tierName = 'Máy khỏe';
    recommendedMaxParticipants = 1000;
  }

  return {
    cpuCount,
    cpuModel: cpus[0] ? cpus[0].model.trim() : 'CPU',
    totalRamGB,
    freeRamGB,
    tier,
    tierName,
    recommendedMaxParticipants
  };
}

// Đo thực tế: máy này chấm được bao nhiêu comment/giây (để biết giới hạn có thật sự cần không)
function benchmarkJudging() {
  const { matchAnswer } = require('./answer');
  const samples = [
    'convenient',
    'đáp án là convenient nha',
    'hello mọi người ơi',
    'conveniant',
    'em đoán là appreciate',
    '😂😂😂'
  ];
  const iterations = 20000;
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    matchAnswer(samples[i % samples.length], 'convenient');
  }
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  return Math.round(iterations / (elapsedMs / 1000));
}

module.exports = { getHardwareProfile, benchmarkJudging };
