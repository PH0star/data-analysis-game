/**
 * DataQuest Sync Channel
 * 支援 Firebase Realtime Database 與 本地 BroadcastChannel / LocalStorage 雙模同步
 */

class GameSync {
  constructor(roomId = 'DA-ROOM-888', role = 'viewer') {
    this.roomId = roomId;
    this.role = role; // 'host', 'projector', 'player'
    this.listeners = {};
    this.channelName = `game_sync_${this.roomId}`;
    this.firebaseDb = null;
    this.isFirebaseReady = false;

    // 1. 初始化本地廣播頻道 (支援延伸螢幕與同機多分頁即時通訊)
    if (typeof BroadcastChannel !== 'undefined') {
      this.bc = new BroadcastChannel(this.channelName);
      this.bc.onmessage = (event) => {
        const { type, data } = event.data || {};
        this._trigger(type, data);
      };
    }

    // 監聽跨視窗 localStorage 作為備援
    window.addEventListener('storage', (e) => {
      if (e.key === `state_${this.roomId}` && e.newValue) {
        try {
          const payload = JSON.parse(e.newValue);
          this._trigger(payload.type, payload.data);
        } catch (err) {}
      }
    });
  }

  // 初始化 Firebase (若有提供配置)
  initFirebase(firebaseConfig) {
    if (typeof firebase !== 'undefined' && firebaseConfig && firebaseConfig.apiKey) {
      try {
        if (!firebase.apps.length) {
          firebase.initializeApp(firebaseConfig);
        }
        this.firebaseDb = firebase.database();
        this.isFirebaseReady = true;
        console.log('[Sync] Firebase Realtime DB connected');

        // 監聽 Firebase 房間狀態更新
        const roomRef = this.firebaseDb.ref(`rooms/${this.roomId}`);
        roomRef.on('value', (snapshot) => {
          const val = snapshot.val();
          if (val) {
            this._trigger('room_state_update', val);
          }
        });
      } catch (e) {
        console.warn('[Sync] Firebase init failed, fallback to local channel', e);
      }
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
      this.listeners[event].forEach(cb => cb(data));
    }
  }

  // 廣播事件與狀態變更
  emit(type, data) {
    const payload = { type, data, timestamp: Date.now() };

    // 本地廣播
    if (this.bc) {
      this.bc.postMessage(payload);
    }
    try {
      localStorage.setItem(`state_${this.roomId}`, JSON.stringify(payload));
    } catch (e) {}

    // 本地即時觸發自己
    this._trigger(type, data);

    // 若有 Firebase 則同步寫入雲端
    if (this.isFirebaseReady && this.firebaseDb) {
      if (type === 'update_state') {
        this.firebaseDb.ref(`rooms/${this.roomId}/state`).update(data);
      } else if (type === 'submit_answer') {
        this.firebaseDb.ref(`rooms/${this.roomId}/responses/${data.playerId}`).set(data);
      } else if (type === 'buzzer_trigger') {
        // 使用 transaction 確保搶答唯一毫秒判定
        this.firebaseDb.ref(`rooms/${this.roomId}/buzzer_winner`).transaction((current) => {
          if (current === null) {
            return data;
          }
          return; // 已有搶答者則不覆蓋
        });
      }
    }
  }

  // 讀取當前儲存之狀態快照
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
