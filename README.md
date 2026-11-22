# 🎬 TikTok Live Vocab Studio

Trò chơi đoán từ vựng tiếng Anh cho TikTok Live: người xem nhìn **phiên âm IPA + nghĩa tiếng Việt**, comment đúng từ, và được **giải thích cách dùng** ngay sau đó.

## Chạy

```bash
npm install
npm start        # server + game engine
npm test         # 22 bài kiểm thử nhanh
```

| Màn hình | Địa chỉ | Dùng để |
|---|---|---|
| Điều khiển | `http://localhost:3000` | Kết nối TikTok, cài đặt, bấm câu tiếp, xem comment |
| Treo live (điện thoại) | `http://<IP-LAN>:3000/?mode=stream` | Chia sẻ màn hình lên TikTok, không có nút điều khiển |
| Bảng xếp hạng | `http://<IP-LAN>:3000/bxh` | BXH phiên này + BXH tổng mọi phiên |

Mọi màn hình hiển thị **cùng một trận** vì logic chạy trên server.

## Kiến trúc

```
TikTok Live ──comment──▶ src/tiktok-bridge.js ──▶ src/game-engine.js ──socket.io──▶ các màn hình
                                                   │  (đồng hồ, gợi ý, chấm điểm, BXH)
                                                   └─▶ data/*.json (cài đặt, BXH tổng, từ tự thêm)
```

- `src/game-engine.js` — vòng câu hỏi: ĐOÁN → ĐÁP ÁN (+ cửa sổ bù trễ) → BXH → câu tiếp.
- `src/answer.js` — chấm comment (bỏ dấu, tìm từ trong câu, chấp nhận sai 1 ký tự với từ ≥ 8 chữ, nửa điểm).
- `src/importer.js` — nhập từ hàng loạt bằng CSV/JSON (dán thẳng từ Google Sheets).
- `data/vocabulary.json` — bộ từ gốc (6 chủ đề).

## Luật chơi

- Top 3 người đúng đầu tiên: **10 / 7 / 5** điểm (chỉnh 1–5 người). Đúng muộn trong cửa sổ bù trễ: +1.
- **Bù trễ live** (mặc định 4s): người xem thấy màn hình chậm hơn host, nên sau khi mở đáp án vẫn nhận câu trả lời trong khoảng này.
- Gợi ý tăng dần: chữ đầu → phát âm ở 35% → mở thêm chữ ở 55% và 75%.
- Chống spam đoán mò: mỗi người chỉ được chấm 1 lần mỗi 1,5s.

## Biến môi trường (tuỳ chọn)

| Biến | Ý nghĩa |
|---|---|
| `PORT` | Cổng server (mặc định 3000) |
| `BIND_HOST` | `0.0.0.0` (mặc định, cho điện thoại cùng mạng xem) hoặc `127.0.0.1` (chỉ máy này) |
| `HOST_KEY` | Không đặt: chỉ máy chạy server được điều khiển. Có đặt: thiết bị mở `?key=...` mới điều khiển được |
| `TIKTOK_SIGN_API_KEY` | API key Euler Stream để kết nối TikTok ổn định hơn gói miễn phí |

## Bảo mật

- Thiết bị khác trong mạng **chỉ được xem**; quyền điều khiển chỉ thuộc về `localhost` hoặc người có `HOST_KEY`.
- Socket chỉ nhận kết nối cùng nguồn (chặn trang web lạ điều khiển ngầm), giới hạn 10 lệnh/giây mỗi thiết bị.
- Không lưu mật khẩu/cookie TikTok. Chỉ đọc comment công khai qua TikTok ID.
- Dữ liệu người xem (TikTok ID, nickname, điểm) nằm trong `data/leaderboard-alltime.json` trên máy bạn.
- Không có HTTPS: chỉ dùng trong mạng tin cậy, **không mở port ra Internet**.
