/**
 * DataQuest Sync Channel
 * 雙模同步引擎：支援 Firebase Realtime Database 雲端即時長連線 與 本地 BroadcastChannel / LocalStorage
 */

class GameSync {
  constructor(roomId = 'DA-ROOM-888', role = 'viewer') {
    this.roomId = roomId;
    this.role = role; // 'host', 'projector', 'player'
    this.listeners = {};
    this.channelName = `game_sync_${this.roomId}`;
    this.firebaseDb = null;
    this.isFirebaseReady = false;
    this.currentPlayerId = null;
    this.currentPlayerName = null;
    this.currentGroup = null;

    // 1. 初始化本地廣播頻道 (同機分頁即時備援)
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.bc = new BroadcastChannel(this.channelName);
        this.bc.onmessage = (event) => {
          const { type, data } = event.data || {};
          if (type) this._trigger(type, data);
        };
      } catch (e) {
        console.warn('[Sync] BroadcastChannel not supported', e);
      }
    }

    // 2. 本地跨視窗 storage 事件備援
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

    // 3. 自動偵測全域 FIREBASE_CONFIG 並初始化雲端連線
    if (typeof window !== 'undefined' && window.FIREBASE_CONFIG) {
      this.initFirebase(window.FIREBASE_CONFIG);
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
      this.isFirebaseReady = true;
      console.log(`[Sync] Firebase Realtime DB 已連線 (房間: ${this.roomId}, 角色: ${this.role})`);
      this._trigger('firebase_connected', { roomId: this.roomId });

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

      // (C) Host 專屬監聽：學員作答與在線名單
      if (this.role === 'host') {
        // 監聽個別作答提交與更新
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

        // 監聽所有作答批次變更（如主控台清空題目前）
        roomRef.child('responses').on('value', (snapshot) => {
          const allResponses = snapshot.val() || {};
          this._trigger('responses_batch', allResponses);
        });

        // 監聽學員進房名單
        roomRef.child('players').on('value', (snapshot) => {
          const players = snapshot.val() || {};
          const count = Object.keys(players).length;
          this._trigger('players_update', { count, players });
        });
      }

      // (D) Player 專屬：登入時註冊在線狀態
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

    } catch (err) {
      console.error('[Sync] Firebase 初始化異常:', err);
    }
  }

  // 註冊學員身分（供在線人數統計）
  registerPlayer(playerId, playerName, group) {
    this.currentPlayerId = playerId;
    this.currentPlayerName = playerName;
    this.currentGroup = group;
    if (this.isFirebaseReady && this.firebaseDb) {
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

    // 本地立即觸發 (適用於本機同一頁面元件)
    this._trigger(type, data);

    // 2. 雲端 Firebase 同步寫入
    if (this.isFirebaseReady && this.firebaseDb) {
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

      // (B) 學員提交答案 (Player -> Host)
      else if (type === 'submit_answer') {
        if (data && data.playerId) {
          roomRef.child(`responses/${data.playerId}`).set(data);
        }
      }

      // (C) 極速搶答 (Player -> Transaction 唯一得主判定)
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
          } else {
            console.log('[Sync] 搶答已被搶先');
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
