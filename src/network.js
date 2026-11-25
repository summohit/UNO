// Thin WebSocket client. The server runs the game; this only sends
// requests and passes server messages to the handlers.
export class MultiplayerClient {
  constructor(handlers) {
    this.handlers = handlers;
    this.ws = null;
    this.clientId = null;
    this.room = null;
    this.localSeat = 0;
    this.isConnected = false;
    this._connect();
  }

  _connect() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    try {
      this.ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    } catch {
      setTimeout(() => this._connect(), 2500);
      return;
    }

    this.ws.addEventListener('open', () => {
      this.isConnected = true;
      this.handlers.onConnectionChange?.(true);
    });

    this.ws.addEventListener('message', (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      this._onMessage(data);
    });

    this.ws.addEventListener('close', () => {
      const wasInRoom = Boolean(this.room);
      this.isConnected = false;
      this.room = null;
      this.handlers.onConnectionChange?.(false, wasInRoom);
      setTimeout(() => this._connect(), 2500);
    });
  }

  _onMessage(data) {
    const h = this.handlers;
    switch (data.type) {
      case 'welcome':
        this.clientId = data.clientId;
        if (typeof data.onlineCount === 'number') h.onOnlineCount?.(data.onlineCount);
        break;
      case 'online_count':
        h.onOnlineCount?.(data.count);
        break;
      case 'room_joined':
        this.room = data.room;
        this.localSeat = data.seat;
        h.onRoomJoined?.(this.room, this.localSeat);
        break;
      case 'room_updated':
        if (!this.room) return;
        this.room = data.room;
        this.localSeat = data.seat;
        h.onRoomUpdated?.(this.room, this.localSeat);
        break;
      case 'room_error':
        h.onRoomError?.(data.message);
        break;
      case 'match_started':
        this.room = data.room;
        this.localSeat = data.seat;
        h.onMatchStarted?.(this.room, this.localSeat);
        break;
      case 'game_update':
        if (this.room) h.onGameUpdate?.(data);
        break;
      case 'action_error':
        h.onActionError?.(data.error);
        break;
      case 'room_emote':
        h.onRoomEmote?.(data.seat, data.playerName, data.emote);
        break;
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
    return Boolean(this.room) && this.room.hostId === this.clientId;
  }

  createRoom(roomName, playerName, rules) {
    if (!this._send({ type: 'create_room', roomName, playerName, rules })) {
      this.handlers.onRoomError?.('Not connected to the game server. Try again in a moment.');
    }
  }

  joinRoom(roomCodeOrName, playerName) {
    if (!this._send({ type: 'join_room', roomCode: roomCodeOrName, playerName })) {
      this.handlers.onRoomError?.('Not connected to the game server. Try again in a moment.');
    }
  }

  toggleSeatBot(seat) {
    this._send({ type: 'toggle_bot', seat });
  }

  leaveRoom() {
    this._send({ type: 'leave_room' });
    this.room = null;
    this.localSeat = 0;
  }

  updateRules(rules) {
    this._send({ type: 'update_rules', rules });
  }

  requestStartMatch() {
    this._send({ type: 'start_match' });
  }

  sendAction(action) {
    this._send({ type: 'action', action });
  }

  sendEmote(emote) {
    this._send({ type: 'emote', emote });
  }
}
