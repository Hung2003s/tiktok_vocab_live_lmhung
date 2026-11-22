// Cầu nối TikTok Live (tiktok-live-connector v2): đọc comment, tự kết nối lại khi rớt mạng.
const EventEmitter = require('events');
const { TikTokLiveConnection, WebcastEvent, ControlEvent } = require('tiktok-live-connector');

const MAX_RECONNECT_ATTEMPTS = 6;

class TikTokBridge extends EventEmitter {
  constructor() {
    super();
    this.connection = null;
    this.username = null;
    this.status = 'disconnected';
    this.message = 'Chưa kết nối TikTok Live';
    this.viewerCount = 0;
    this.manualDisconnect = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
  }

  snapshot() {
    return {
      status: this.status,
      username: this.username,
      viewerCount: this.viewerCount,
      message: this.message
    };
  }

  setStatus(status, message) {
    this.status = status;
    if (message) this.message = message;
    this.emit('status', this.snapshot());
  }

  async connect(rawUsername) {
    const username = String(rawUsername || '')
      .trim()
      .replace(/^https?:\/\/(www\.)?tiktok\.com\//i, '')
      .replace(/^@/, '')
      .replace(/\/live\/?$/i, '');

    if (!username) {
      this.setStatus('error', 'Vui lòng nhập TikTok ID, ví dụ @ten_kenh');
      return;
    }

    this.disconnect(false);
    this.username = username;
    this.manualDisconnect = false;
    await this.open();
  }

  async open() {
    this.setStatus('connecting', `Đang kết nối tới @${this.username}...`);

    const connection = new TikTokLiveConnection(this.username, {
      processInitialData: false, // không chấm lại các comment cũ trước khi kết nối
      fetchRoomInfoOnConnect: true,
      enableExtendedGiftInfo: false,
      signApiKey: process.env.TIKTOK_SIGN_API_KEY || undefined
    });
    this.connection = connection;

    connection.on(WebcastEvent.CHAT, (data) => {
      const user = data.user || {};
      const uniqueId = user.uniqueId || user.userId || 'viewer';
      this.emit('chat', {
        uniqueId: String(uniqueId),
        nickname: user.nickname || String(uniqueId),
        comment: data.comment || ''
      });
    });

    connection.on(WebcastEvent.GIFT, (data) => {
      // Quà liên tục (giftType 1): chỉ tính 1 lần khi chuỗi kết thúc, tránh đổi chủ đề nhiều lần
      if (data.giftType === 1 && !data.repeatEnd) return;
      const user = data.user || {};
      const uniqueId = user.uniqueId || user.userId || 'viewer';
      this.emit('gift', {
        uniqueId: String(uniqueId),
        nickname: user.nickname || String(uniqueId),
        giftName: String(data.giftName || data.giftDetails?.giftName || data.gift?.name || ''),
        diamonds: Number(data.diamondCount || data.giftDetails?.diamondCount || 0),
        count: Number(data.repeatCount) || 1
      });
    });

    connection.on(WebcastEvent.ROOM_USER, (data) => {
      this.viewerCount = Number(data.viewerCount) || this.viewerCount;
      this.emit('status', this.snapshot());
    });

    connection.on(WebcastEvent.STREAM_END, () => {
      this.manualDisconnect = true;
      this.setStatus('disconnected', 'Phiên TikTok Live đã kết thúc.');
    });

    connection.on(ControlEvent.DISCONNECTED, () => {
      if (this.connection !== connection) return;
      if (this.manualDisconnect) return;
      this.scheduleReconnect();
    });

    connection.on(ControlEvent.ERROR, (err) => {
      console.error('[tiktok] lỗi:', err?.info || err?.message || err);
    });

    try {
      await connection.connect();
      this.reconnectAttempts = 0;
      this.setStatus('connected', `Đã kết nối @${this.username}`);
    } catch (err) {
      if (this.connection !== connection) return;
      const reason = err?.message || String(err);
      const offline = /offline|not live|UserOffline/i.test(reason) || err?.constructor?.name === 'UserOfflineError';
      if (offline) {
        this.setStatus('error', `@${this.username} hiện không phát live. Hãy bật live trước rồi kết nối lại.`);
        return;
      }
      this.scheduleReconnect(reason);
    }
  }

  scheduleReconnect(reason) {
    clearTimeout(this.reconnectTimer);
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.setStatus('error', `Không thể kết nối @${this.username} sau ${MAX_RECONNECT_ATTEMPTS} lần thử. ${reason || ''}`.trim());
      return;
    }
    this.reconnectAttempts += 1;
    const delay = Math.min(30000, 2000 * 2 ** (this.reconnectAttempts - 1));
    this.setStatus('connecting', `Mất kết nối, thử lại sau ${Math.round(delay / 1000)}s (lần ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  disconnect(announce = true) {
    this.manualDisconnect = true;
    clearTimeout(this.reconnectTimer);
    const conn = this.connection;
    this.connection = null;
    if (conn) {
      try {
        conn.disconnect();
      } catch {
        // bỏ qua lỗi khi đóng
      }
    }
    this.viewerCount = 0;
    if (announce) this.setStatus('disconnected', 'Đã ngắt kết nối TikTok Live.');
  }
}

module.exports = { TikTokBridge };
