export class MultiplayerClient {
  constructor(handlers) {
    this.handlers = handlers;
    this.ws = null;
    this.bc =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel('uno_3d_multiplayer_channel')
        : null;
    this.clientId = `local_${Math.random().toString(36).slice(2, 10)}`;
    this.room = null;
    this.localSeat = 0;
    this.isConnected = false;

    this._connectWebSocket();
    this._setupBroadcastFallback();
  }

  _connectWebSocket() {
    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/ws`;
      this.ws = new WebSocket(url);

      this.ws.addEventListener('open', () => {
        this.isConnected = true;
        if (this.handlers.onConnectionChange) {
          this.handlers.onConnectionChange(true);
        }
      });

      this.ws.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data);
          this._handleServerMessage(data);
        } catch (_) {
          // Ignore malformed packet
        }
      });

      this.ws.addEventListener('close', () => {
        this.isConnected = false;
        if (this.handlers.onConnectionChange) {
          this.handlers.onConnectionChange(false);
        }
        setTimeout(() => this._connectWebSocket(), 2500);
      });
    } catch (_) {
      this.isConnected = false;
    }
  }

  _setupBroadcastFallback() {
    if (!this.bc) return;
    this.bc.addEventListener('message', (event) => {
      if (this.isConnected) return;
      const data = event.data;
      if (!data) return;
      this._handleBroadcastFallbackMessage(data);
    });
  }

  _handleServerMessage(data) {
    switch (data.type) {
      case 'welcome':
        this.clientId = data.clientId;
        if (typeof data.onlineCount === 'number' && this.handlers.onOnlineCount) {
          this.handlers.onOnlineCount(data.onlineCount);
        }
        break;
      case 'online_count':
        if (this.handlers.onOnlineCount) {
          this.handlers.onOnlineCount(data.count);
        }
        break;
      case 'room_joined':
        this.clientId = data.clientId || this.clientId;
        this.localSeat = data.seat;
        this.room = data.room;
        if (this.handlers.onRoomJoined) {
          this.handlers.onRoomJoined(this.room, this.localSeat, data.lastState);
        }
        break;
      case 'room_updated':
        this.room = data.room;
        const me = this.room.players.find((p) => p.id === this.clientId);
        if (me) this.localSeat = me.seat;
        if (this.handlers.onRoomUpdated) {
          this.handlers.onRoomUpdated(this.room, this.localSeat);
        }
        break;
      case 'room_error':
        if (this.handlers.onRoomError) {
          this.handlers.onRoomError(data.message);
        }
        break;
      case 'match_started':
        this.room = data.room;
        if (this.handlers.onMatchStarted) {
          this.handlers.onMatchStarted(this.room, this.localSeat);
        }
        break;
      case 'game_state_sync':
        if (this.handlers.onGameStateSync) {
          this.handlers.onGameStateSync(data.state, data.event);
        }
        break;
      case 'remote_player_action':
        if (this.handlers.onRemotePlayerAction) {
          this.handlers.onRemotePlayerAction(data.seat, data.action);
        }
        break;
      case 'room_emote':
        if (this.handlers.onRoomEmote) {
          this.handlers.onRoomEmote(data.seat, data.playerName, data.emote);
        }
        break;
    }
  }

  _handleBroadcastFallbackMessage(data) {
    if (data.type === 'bc_join_request' && this.isHost()) {
      const query = (data.roomCode || '').trim();
      if (
        !this.room ||
        (this.room.code !== query.toUpperCase() &&
          this.room.roomName.toLowerCase() !== query.toLowerCase())
      ) {
        return;
      }
      let existing = this.room.players.find((p) => p.id === data.clientId);
      if (!existing && this.room.players.length < 4) {
        const takenSeats = new Set(this.room.players.map((p) => p.seat));
        let seat = 0;
        while (takenSeats.has(seat) && seat < 4) seat++;
        existing = {
          id: data.clientId,
          name: data.playerName || `Player ${seat + 1}`,
          email: data.playerEmail || '',
          seat,
          isBot: false,
          connected: true,
        };
        this.room.players.push(existing);
      }
      if (existing) {
        this.bc.postMessage({
          type: 'bc_room_joined',
          targetClientId: data.clientId,
          seat: existing.seat,
          room: this.room,
        });
        if (this.handlers.onRoomUpdated) {
          this.handlers.onRoomUpdated(this.room, this.localSeat);
        }
      }
    } else if (
      data.type === 'bc_room_joined' &&
      data.targetClientId === this.clientId
    ) {
      this.localSeat = data.seat;
      this.room = data.room;
      if (this.handlers.onRoomJoined) {
        this.handlers.onRoomJoined(this.room, this.localSeat, null);
      }
    } else if (
      data.type === 'bc_room_updated' &&
      this.room &&
      data.room.code === this.room.code
    ) {
      this.room = data.room;
      if (this.handlers.onRoomUpdated) {
        this.handlers.onRoomUpdated(this.room, this.localSeat);
      }
    } else if (
      data.type === 'bc_match_started' &&
      this.room &&
      data.room.code === this.room.code
    ) {
      this.room = data.room;
      if (this.handlers.onMatchStarted) {
        this.handlers.onMatchStarted(this.room, this.localSeat);
      }
    } else if (
      data.type === 'bc_game_state_sync' &&
      this.room &&
      data.roomCode === this.room.code &&
      !this.isHost()
    ) {
      if (this.handlers.onGameStateSync) {
        this.handlers.onGameStateSync(data.state, data.event);
      }
    } else if (
      data.type === 'bc_remote_action' &&
      this.room &&
      data.roomCode === this.room.code &&
      this.isHost()
    ) {
      if (this.handlers.onRemotePlayerAction) {
        this.handlers.onRemotePlayerAction(data.seat, data.action);
      }
    } else if (
      data.type === 'bc_emote' &&
      this.room &&
      data.roomCode === this.room.code
    ) {
      if (this.handlers.onRoomEmote) {
        this.handlers.onRoomEmote(data.seat, data.playerName, data.emote);
      }
    }
  }

  _send(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }

  isInRoom() {
    return Boolean(this.room);
  }

  isHost() {
    return !this.room || this.room.hostId === this.clientId;
  }

  createRoom(roomName, playerName, playerEmail, rules) {
    if (
      this._send({
        type: 'create_room',
        roomName,
        playerName,
        playerEmail,
        rules,
      })
    ) {
      return;
    }
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    this.localSeat = 0;
    this.room = {
      code,
      roomName: roomName || 'UNO Room',
      hostId: this.clientId,
      started: false,
      rules: { ...rules, fillWithBots: false },
      players: [
        {
          id: this.clientId,
          name: playerName || 'Admin',
          email: playerEmail || '',
          seat: 0,
          isBot: false,
          connected: true,
        },
      ],
    };
    if (this.handlers.onRoomJoined) {
      this.handlers.onRoomJoined(this.room, 0, null);
    }
  }

  joinRoom(roomCodeOrName, playerName, playerEmail) {
    const cleanQuery = (roomCodeOrName || '').trim();
    if (
      this._send({
        type: 'join_room',
        roomCode: cleanQuery,
        playerName,
        playerEmail,
      })
    ) {
      return;
    }
    if (this.bc) {
      this.bc.postMessage({
        type: 'bc_join_request',
        roomCode: cleanQuery,
        playerName,
        playerEmail,
        clientId: this.clientId,
      });
    }
  }

  toggleSeatBot(seat) {
    if (!this.room || !this.isHost()) return;
    if (this._send({ type: 'admin_toggle_seat_bot', seat })) return;
  }

  leaveRoom() {
    this._send({ type: 'leave_room' });
    this.room = null;
    this.localSeat = 0;
  }

  updateRules(rules) {
    if (!this.room || !this.isHost()) return;
    this.room.rules = { ...this.room.rules, ...rules };
    if (!this._send({ type: 'update_rules', rules: this.room.rules }) && this.bc) {
      this.bc.postMessage({ type: 'bc_room_updated', room: this.room });
    }
  }

  requestAdminStartMatch() {
    if (!this.room || !this.isHost()) return;
    if (this._send({ type: 'host_start_match' })) return;
    if (this.room.players.length < 2) {
      if (this.handlers.onRoomError) {
        this.handlers.onRoomError(
          'At least 2 players are needed to start! Wait for a friend to join or click "+ Add AI Bot" on a vacant seat.'
        );
      }
      return;
    }
    this.room.started = true;
    if (this.bc) {
      this.bc.postMessage({ type: 'bc_match_started', room: this.room });
    }
    if (this.handlers.onMatchStarted) {
      this.handlers.onMatchStarted(this.room, this.localSeat);
    }
  }

  syncStateFromHost(state, event = null) {
    if (!this.room || !this.isHost()) return;
    if (!this._send({ type: 'game_state_sync', state, event }) && this.bc) {
      this.bc.postMessage({
        type: 'bc_game_state_sync',
        roomCode: this.room.code,
        state,
        event,
      });
    }
  }

  sendGuestAction(action) {
    if (!this.room) return;
    if (
      !this._send({
        type: 'remote_player_action',
        seat: this.localSeat,
        action,
      }) &&
      this.bc
    ) {
      this.bc.postMessage({
        type: 'bc_remote_action',
        roomCode: this.room.code,
        seat: this.localSeat,
        action,
      });
    }
  }

  sendEmote(playerName, emote) {
    if (!this.room) return;
    if (
      !this._send({
        type: 'room_emote',
        seat: this.localSeat,
        playerName,
        emote,
      }) &&
      this.bc
    ) {
      this.bc.postMessage({
        type: 'bc_emote',
        roomCode: this.room.code,
        seat: this.localSeat,
        playerName,
        emote,
      });
      if (this.handlers.onRoomEmote) {
        this.handlers.onRoomEmote(this.localSeat, playerName, emote);
      }
    }
  }
}
