/**
 * DataQuest Sync Channel
 * 雙模同步引擎：支援 Firebase Realtime Database 雲端即時長連線 與 本地 BroadcastChannel / LocalStorage
 */

const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyBPsCFx3kdMRcaA0W3lPmlV8eMMuY_xTyk",
  authDomain: "data-analysis-quiz-7b4d3.firebaseapp.com",
  databaseURL: "https://data-analysis-quiz-7b4d3-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "data-analysis-quiz-7b4d3",
  storageBucket: "data-analysis-quiz-7b4d3.firebasestorage.app",
  messagingSenderId: "421643705789",
  appId: "1:421643705789:web:29062c6c9288ec5f2386d4"
};

class GameSync {
  constructor(roomId = 'DA-ROOM-888', role = 'viewer') {
    this.roomId = roomId;
    this.role = role; // 'host', 'projector', 'player'
    this.listeners = {};
    this.firebaseDb = null;
    this.isFirebaseReady = false;
    this.currentPlayerId = null;
    this.currentPlayerName = null;
    this.currentGroup = null;

    this._initLocalChannel();

    // 自動偵測全域 FIREBASE_CONFIG 或使用預設內嵌配置
    const config = (typeof window !== 'undefined' && window.FIREBASE_CONFIG) ? window.FIREBASE_CONFIG : DEFAULT_FIREBASE_CONFIG;
    this.initFirebase(config);
  }

  _initLocalChannel() {
    this.channelName = `game_sync_${this.roomId}`;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        if (this.bc) this.bc.close();
        this.bc = new BroadcastChannel(this.channelName);
        this.bc.onmessage = (event) => {
          const { type, data } = event.data || {};
          if (type) this._trigger(type, data);
        };
      } catch (e) {
        console.warn('[Sync] BroadcastChannel error:', e);
      }
    }

    if (typeof window !== 'undefined' && window.addEventListener && !this._storageListenerBound) {
      window.addEventListener('storage', (e) => {
        if (e.key === `state_${this.roomId}` && e.newValue) {
          try {
            const payload = JSON.parse(e.newValue);
            if (payload && payload.type) {
              this._trigger(payload.type, payload.data);
            }
          } catch (err) {}
        }
      });
      this._storageListenerBound = true;
    }
  }

  // 初始化 Firebase Realtime Database
  initFirebase(config) {
    if (typeof firebase === 'undefined') {
      console.warn('[Sync] Firebase SDK 未載入，維持本地模式');
      return;
    }
    if (!config || !config.apiKey || !config.databaseURL) {
      console.warn('[Sync] Firebase Config 不完整，維持本地模式');
      return;
    }

    try {
      if (!firebase.apps || !firebase.apps.length) {
        firebase.initializeApp(config);
      }
      this.firebaseDb = firebase.database();

      // 監聽真正網路長連線狀態
      const connectedRef = this.firebaseDb.ref('.info/connected');
      connectedRef.on('value', (snap) => {
        const isOnline = snap.val() === true;
        this.isFirebaseReady = isOnline;
        this._trigger('connection_status', { online: isOnline, roomId: this.roomId });
        if (isOnline) {
          console.log(`[Sync] 🟢 Firebase 已連線至雲端伺服器 (房間: ${this.roomId}, 角色: ${this.role})`);
          this._trigger('firebase_connected', { roomId: this.roomId });
        } else {
          console.log('[Sync] 🟡 Firebase 目前離線中');
        }
      });

      this._bindRoomListeners();

    } catch (err) {
      console.error('[Sync] Firebase 初始化異常:', err);
    }
  }

  _bindRoomListeners() {
    if (!this.firebaseDb) return;
    const roomRef = this.firebaseDb.ref(`rooms/${this.roomId}`);

    // (A) 監聽遊戲狀態更新 (Host 廣播，Projector 與 Player 接收)
    roomRef.child('state').on('value', (snapshot) => {
      const state = snapshot.val();
      if (state) {
        this._trigger('state_change', state);
      }
    });

    // (B) 監聽搶答結果 (Buzzer Winner)
    roomRef.child('buzzer_winner').on('value', (snapshot) => {
      const winner = snapshot.val();
      if (winner) {
        this._trigger('buzzer_hit', winner);
      }
    });

    // (C) 監聽學員進房名單與在線人數
    roomRef.child('players').on('value', (snapshot) => {
      const players = snapshot.val() || {};
      const count = Object.keys(players).length;
      this._trigger('players_update', { count, players });
    });

    // (D) Host 專屬監聽：學員作答
    if (this.role === 'host') {
      roomRef.child('responses').on('child_added', (snapshot) => {
        const answer = snapshot.val();
        if (answer) {
          this._trigger('submit_answer', answer);
        }
      });
      roomRef.child('responses').on('child_changed', (snapshot) => {
        const answer = snapshot.val();
        if (answer) {
          this._trigger('submit_answer', answer);
        }
      });
      roomRef.child('responses').on('value', (snapshot) => {
        const allResponses = snapshot.val() || {};
        this._trigger('responses_batch', allResponses);
      });
    }

    // (E) Player 專屬：連線狀態保持
    if (this.role === 'player') {
      const connectedRef = this.firebaseDb.ref('.info/connected');
      connectedRef.on('value', (snap) => {
        if (snap.val() === true && this.currentPlayerId) {
          const myPlayerRef = roomRef.child(`players/${this.currentPlayerId}`);
          myPlayerRef.onDisconnect().remove();
          myPlayerRef.update({
            id: this.currentPlayerId,
            name: this.currentPlayerName || '學員',
            group: this.currentGroup || '',
            online: true,
            lastSeen: firebase.database.ServerValue.TIMESTAMP
          });
        }
      });
    }
  }

  // 切換房間
  switchRoom(newRoomId) {
    if (!newRoomId || newRoomId === this.roomId) return;
    this.roomId = newRoomId;
    this._initLocalChannel();
    this._bindRoomListeners();
    console.log(`[Sync] 已切換至新房間: ${this.roomId}`);
  }

  // 註冊學員身分（供在線人數統計）
  registerPlayer(playerId, playerName, group) {
    this.currentPlayerId = playerId;
    this.currentPlayerName = playerName;
    this.currentGroup = group;
    if (this.firebaseDb) {
      const myPlayerRef = this.firebaseDb.ref(`rooms/${this.roomId}/players/${playerId}`);
      myPlayerRef.onDisconnect().remove();
      myPlayerRef.set({
        id: playerId,
        name: playerName,
        group: group || '',
        online: true,
        joinedAt: firebase.database.ServerValue.TIMESTAMP
      });
    }
  }

  // 註冊事件監聽
  on(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  _trigger(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => {
        try { cb(data); } catch (e) { console.error(`[Sync] Error in listener '${event}':`, e); }
      });
    }
  }

  // 廣播事件與狀態變更
  emit(type, data) {
    const payload = { type, data, timestamp: Date.now() };

    // 1. 本地廣播
    if (this.bc) {
      try { this.bc.postMessage(payload); } catch (e) {}
    }
    try {
      localStorage.setItem(`state_${this.roomId}`, JSON.stringify(payload));
    } catch (e) {}

    // 本地立即觸發
    this._trigger(type, data);

    // 2. 雲端 Firebase 同步寫入
    if (this.firebaseDb) {
      const roomRef = this.firebaseDb.ref(`rooms/${this.roomId}`);

      // (A) 狀態變更 (Host -> 全體)
      if (type === 'state_change' || type === 'update_state') {
        roomRef.child('state').set(data);

        // 若換新題目或回到大廳，自動清理上一題的作答與搶答暫存
        if (data.stage === 'QUESTION_ACTIVE' || data.stage === 'BUZZER_ALERT' || data.stage === 'LOBBY') {
          if (data.stage === 'QUESTION_ACTIVE' || data.stage === 'LOBBY') {
            roomRef.child('responses').remove();
          }
          roomRef.child('buzzer_winner').remove();
        }
      }

      // (B) 儲存全場歷史紀錄到雲端
      else if (type === 'save_history') {
        if (data && data.roundId) {
          roomRef.child(`history/${data.roundId}`).set(data);
        }
      }

      // (C) 學員提交答案 (Player -> Host)
      else if (type === 'submit_answer') {
        if (data && data.playerId) {
          roomRef.child(`responses/${data.playerId}`).set(data);
        }
      }

      // (D) 極速搶答 (Player -> Transaction 唯一得主判定)
      else if (type === 'buzzer_hit' || type === 'buzzer_trigger') {
        roomRef.child('buzzer_winner').transaction((current) => {
          if (current === null) {
            return data; // 第一位搶到者獲勝
          }
          return; // 已有得主，放棄寫入
        }, (error, committed, snapshot) => {
          if (error) {
            console.error('[Sync] Buzzer transaction error:', error);
          } else if (committed) {
            console.log('[Sync] 恭喜成功搶答！', snapshot.val());
          }
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
