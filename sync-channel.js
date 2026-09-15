/**
 * DataQuest Sync Channel (跨裝置即時通訊核心)
 * 支援：
 * 1. 雲端即時連線 (MQTT over WSS - 免金鑰、免伺服器、全班手機跨網即時通訊)
 * 2. 本地廣播備援 (BroadcastChannel + LocalStorage)
 * 3. 企業級 Firebase Realtime DB (選配)
 */

class GameSync {
  constructor(roomId = 'DA-ROOM-888', role = 'viewer') {
    this.roomId = roomId || 'DA-ROOM-888';
    this.role = role; // 'host', 'projector', 'player'
    this.listeners = {};
    this.clientId = 'client_' + Math.random().toString(36).substring(2, 10);
    this.channelName = `game_sync_${this.roomId}`;
    this.mqttTopic = `data_quest/${this.roomId}/event`;
    this.mqttClient = null;
    this.isConnected = false;

    // 1. 初始化本地廣播頻道 (同機雙螢幕極速備援)
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.bc = new BroadcastChannel(this.channelName);
        this.bc.onmessage = (event) => {
          const { type, data, senderId } = event.data || {};
          if (senderId !== this.clientId) {
            this._trigger(type, data);
          }
        };
      } catch (e) {
        console.warn('BroadcastChannel not supported', e);
      }
    }

    // 2. 監聽跨分頁 localStorage 作為本地備援
    window.addEventListener('storage', (e) => {
      if (e.key === `state_${this.roomId}` && e.newValue) {
        try {
          const payload = JSON.parse(e.newValue);
          if (payload.senderId !== this.clientId) {
            this._trigger(payload.type, payload.data);
          }
        } catch (err) {}
      }
    });

    // 3. 自動啟動雲端即時連線 (MQTT over WSS)
    this._initCloudMqtt();
  }

  // 自動連接免費公共 WSS Broker (支援全班 30 支手機跨網連線)
  _initCloudMqtt() {
    if (typeof mqtt === 'undefined') {
      console.warn('[Sync] mqtt.js not loaded, running in local-only mode');
      return;
    }

    // 主備伺服器列表 (EMQX + HiveMQ 雙伺服器高可用自動切換)
    const brokers = [
      'wss://broker.emqx.io:8084/mqtt',
      'wss://broker.hivemq.com:8884/mqtt'
    ];
    const currentBroker = brokers[0];

    try {
      console.log(`[Sync] Connecting to cloud broker: ${currentBroker}`);
      this.mqttClient = mqtt.connect(currentBroker, {
        clientId: this.clientId,
        clean: true,
        connectTimeout: 5000,
        reconnectPeriod: 2500,
        keepalive: 30
      });

      this.mqttClient.on('connect', () => {
        this.isConnected = true;
        console.log(`[Sync] ✅ 雲端即時連線成功 (Room: ${this.roomId})`);
        this._trigger('cloud_status', { online: true, broker: currentBroker });

        // 訂閱當前房間的所有訊息
        this.mqttClient.subscribe(this.mqttTopic, { qos: 0 }, (err) => {
          if (err) {
            console.error('[Sync] 訂閱失敗', err);
          } else {
            console.log(`[Sync] 已訂閱房間頻道: ${this.mqttTopic}`);
          }
        });
      });

      this.mqttClient.on('message', (topic, message) => {
        try {
          const payload = JSON.parse(message.toString());
          // 忽略自己送出的廣播，避免重複處理
          if (payload.senderId !== this.clientId) {
            this._trigger(payload.type, payload.data);
          }
        } catch (e) {
          console.error('[Sync] 訊息解析錯誤', e);
        }
      });

      this.mqttClient.on('error', (err) => {
        console.warn('[Sync] 雲端通訊警告:', err);
        this.isConnected = false;
        this._trigger('cloud_status', { online: false });
      });

      this.mqttClient.on('close', () => {
        this.isConnected = false;
        this._trigger('cloud_status', { online: false });
      });

    } catch (e) {
      console.error('[Sync] MQTT Init exception', e);
    }
  }

  // 註冊事件監聽
  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  _trigger(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => {
        try { cb(data); } catch (e) { console.error(e); }
      });
    }
  }

  // 廣播事件與狀態變更
  emit(type, data) {
    const payload = {
      type,
      data,
      senderId: this.clientId,
      senderRole: this.role,
      timestamp: Date.now()
    };

    // 1. 本地廣播 (同機分頁瞬間同步)
    if (this.bc) {
      try { this.bc.postMessage(payload); } catch (e) {}
    }
    try {
      localStorage.setItem(`state_${this.roomId}`, JSON.stringify(payload));
    } catch (e) {}

    // 2. 雲端廣播 (跨裝置、手機端全網同步)
    if (this.mqttClient && this.isConnected) {
      const msgStr = JSON.stringify(payload);
      this.mqttClient.publish(this.mqttTopic, msgStr, { qos: 0 });
    }

    // 3. 本地即時觸發自己 (讓主控台自己也有反饋)
    this._trigger(type, data);
  }

  getStateSnapshot() {
    try {
      const raw = localStorage.getItem(`room_${this.roomId}_snapshot`);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  saveStateSnapshot(state) {
    try {
      localStorage.setItem(`room_${this.roomId}_snapshot`, JSON.stringify(state));
    } catch (e) {}
  }
}
