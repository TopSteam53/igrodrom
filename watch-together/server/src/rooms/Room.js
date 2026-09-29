import { randomUUID } from 'node:crypto';
import { MAX_MESSAGES_PER_ROOM } from '../config.js';
import { PlaybackState } from '../playback/PlaybackState.js';

// Одна комната: участники онлайн, история чата и общий плеер.
export class Room {
  constructor(id) {
    this.id = id;
    this.createdAt = Date.now();
    // Ключ — id сокета (одна вкладка браузера = один участник).
    this.participants = new Map();
    this.messages = [];
    this.playback = new PlaybackState();
  }

  get isEmpty() {
    return this.participants.size === 0;
  }

  addParticipant(id, nickname) {
    const participant = { id, nickname, joinedAt: Date.now() };
    this.participants.set(id, participant);
    return participant;
  }

  removeParticipant(id) {
    const participant = this.participants.get(id) ?? null;
    this.participants.delete(id);
    return participant;
  }

  getParticipant(id) {
    return this.participants.get(id) ?? null;
  }

  getParticipants() {
    return [...this.participants.values()];
  }

  // message: { type: 'user', text, author: { id, nickname } } или { type: 'system', text }
  addMessage(message) {
    const fullMessage = { id: randomUUID(), createdAt: Date.now(), ...message };
    this.messages.push(fullMessage);
    if (this.messages.length > MAX_MESSAGES_PER_ROOM) {
      this.messages.shift();
    }
    return fullMessage;
  }
}
