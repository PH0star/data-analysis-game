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

    this._initLocalChannels();

    // 自動偵測全域 FIREBASE_CONFIG 或使用預設內嵌配置
    const config = (typeof window !== 'undefined' && window.FIREBASE_CONFIG) ? window.FIREBASE_CONFIG : DEFAULT_FIREBASE_CONFIG;
    this.initFirebase(config);
  }

  // 初始化本地廣播頻道 (同機分頁即時備援)
  _initLocalChannels() {
    this.channelName = `game_sync_${this.roomId}`;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        if (this.bc) this.bc.close();
        this.bc = new BroadcastChannel(this.channelName);
        this.bc.onmessage = (event) => {
          const { type, data } = event.data || {};
          if (type) this._trigger(type, data);
        };

        // 全域廣播頻道 (用於跨房間重定向通知)
        if (!this.globalBc) {
          this.globalBc = new BroadcastChannel('game_sync_global');
          this.globalBc.onmessage = (event) => {
            const { type, data } = event.data || {};
            if (type === 'room_redirect' && data && data.newRoomId) {
              if (this.role !== 'host') {
                this._trigger('room_redirect', data);
              }
            }
          };
        }
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
        if (e.key === 'game_active_room_sync' && e.newValue) {
          try {
            const data = JSON.parse(e.newValue);
            if (data && data.newRoomId && this.role !== 'host') {
              this._trigger('room_redirect', data);
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

      // 監聽全域最新活動房間 (非 host 端可跟隨最新房間)
      if (this.role !== 'host') {
        this.firebaseDb.ref('system/active_room').on('value', (snap) => {
          const val = snap.val();
          if (val && val.roomId && val.roomId !== this.roomId) {
            this._trigger('room_redirect', { oldRoomId: this.roomId, newRoomId: val.roomId, mode: val.mode });
          }
        });
      }

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

    // (B) 監聽舊房間重定向訊號
    roomRef.child('redirect').on('value', (snapshot) => {
      const redirectData = snapshot.val();
      if (redirectData && redirectData.newRoomId && redirectData.newRoomId !== this.roomId) {
        if (this.role !== 'host') {
          this._trigger('room_redirect', redirectData);
        }
      }
    });

    // (C) 監聽搶答結果 (Buzzer Winner)
    roomRef.child('buzzer_winner').on('value', (snapshot) => {
      const winner = snapshot.val();
      if (winner) {
        this._trigger('buzzer_hit', winner);
      }
    });

    // (D) 監聽學員進房名單與在線人數
    roomRef.child('players').on('value', (snapshot) => {
      const players = snapshot.val() || {};
      const count = Object.keys(players).length;
      this._trigger('players_update', { count, players });
    });

    // (E) Host 專屬監聽：學員作答
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

    // (F) Player 專屬：連線狀態保持
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
    const oldRoomId = this.roomId;
    this.roomId = newRoomId;
    this._initLocalChannels();
    this._bindRoomListeners();
    console.log(`[Sync] 已切換至新房間: ${this.roomId} (前房間: ${oldRoomId})`);
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
    // 深度純淨化資料，徹底防止 undefined 破壞 Firebase set
    const sanitizedData = data !== undefined ? JSON.parse(JSON.stringify(data)) : null;
    const payload = { type, data: sanitizedData, timestamp: Date.now() };

    // 1. 本地廣播
    if (this.bc) {
      try { this.bc.postMessage(payload); } catch (e) {}
    }
    if (type === 'room_redirect' && this.globalBc) {
      try { this.globalBc.postMessage(payload); } catch (e) {}
    }
    try {
      localStorage.setItem(`state_${this.roomId}`, JSON.stringify(payload));
      if (type === 'room_redirect') {
        localStorage.setItem('game_active_room_sync', JSON.stringify(sanitizedData));
      }
    } catch (e) {}

    // 本地立即觸發
    this._trigger(type, sanitizedData);

    // 2. 雲端 Firebase 同步寫入
    if (this.firebaseDb) {
      const roomRef = this.firebaseDb.ref(`rooms/${this.roomId}`);

      // (A) 狀態變更 (Host -> 全體)
      if (type === 'state_change' || type === 'update_state') {
        roomRef.child('state').set(sanitizedData);

        // 同步更新全域活動房間資訊
        if (this.role === 'host') {
          this.firebaseDb.ref('system/active_room').set({
            roomId: this.roomId,
            mode: sanitizedData ? sanitizedData.mode : 'INDIVIDUAL',
            stage: sanitizedData ? sanitizedData.stage : 'LOBBY',
            updatedAt: firebase.database.ServerValue.TIMESTAMP
          });
        }

        // 若換新題目或回到大廳，自動清理上一題的作答與搶答暫存
        if (sanitizedData && (sanitizedData.stage === 'QUESTION_ACTIVE' || sanitizedData.stage === 'BUZZER_ALERT' || sanitizedData.stage === 'LOBBY')) {
          if (sanitizedData.stage === 'QUESTION_ACTIVE' || sanitizedData.stage === 'LOBBY') {
            roomRef.child('responses').remove();
          }
          roomRef.child('buzzer_winner').remove();
        }
      }

      // (B) 房間重定向廣播 (Host -> 全體投影與學員端)
      else if (type === 'room_redirect') {
        if (sanitizedData && sanitizedData.oldRoomId) {
          this.firebaseDb.ref(`rooms/${sanitizedData.oldRoomId}/redirect`).set({
            newRoomId: sanitizedData.newRoomId,
            timestamp: firebase.database.ServerValue.TIMESTAMP
          });
        }
        this.firebaseDb.ref('system/active_room').set({
          roomId: sanitizedData.newRoomId,
          updatedAt: firebase.database.ServerValue.TIMESTAMP
        });
      }

      // (C) 儲存全場歷史紀錄到雲端
      else if (type === 'save_history') {
        if (sanitizedData && sanitizedData.roundId) {
          roomRef.child(`history/${sanitizedData.roundId}`).set(sanitizedData);
        }
      }

      // (D) 學員提交答案 (Player -> Host)
      else if (type === 'submit_answer') {
        if (sanitizedData && sanitizedData.playerId) {
          roomRef.child(`responses/${sanitizedData.playerId}`).set(sanitizedData);
        }
      }

      // (E) 極速搶答 (Player -> Transaction 唯一得主判定)
      else if (type === 'buzzer_hit' || type === 'buzzer_trigger') {
        roomRef.child('buzzer_winner').transaction((current) => {
          if (current === null) {
            return sanitizedData; // 第一位搶到者獲勝
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
