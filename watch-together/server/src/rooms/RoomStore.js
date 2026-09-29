import { Room } from './Room.js';
import { generateId } from './generateId.js';

// Хранилище всех комнат в памяти сервера.
// После перезапуска сервера комнаты пропадают — для MVP это нормально.
export class RoomStore {
  constructor({ emptyRoomTtlMs }) {
    this.emptyRoomTtlMs = emptyRoomTtlMs;
    this.rooms = new Map();
    this.deletionTimers = new Map();
  }

  get size() {
    return this.rooms.size;
  }

  create() {
    let id;
    do {
      id = generateId();
    } while (this.rooms.has(id));

    const room = new Room(id);
    this.rooms.set(id, room);
    // Если по ссылке так никто и не зайдёт, комната тоже удалится.
    this.scheduleDeletion(id);
    console.log(`[rooms] создана комната ${id} (всего комнат: ${this.rooms.size})`);
    return room;
  }

  get(id) {
    return this.rooms.get(id) ?? null;
  }

  // Комната опустела — запускаем таймер удаления.
  scheduleDeletion(id) {
    this.cancelDeletion(id);
    const timer = setTimeout(() => {
      this.deletionTimers.delete(id);
      const room = this.rooms.get(id);
      if (room && room.isEmpty) {
        this.rooms.delete(id);
        console.log(`[rooms] комната ${id} удалена: пустовала ${formatDuration(this.emptyRoomTtlMs)} (осталось комнат: ${this.rooms.size})`);
      }
    }, this.emptyRoomTtlMs);
    this.deletionTimers.set(id, timer);
  }

  // Кто-то зашёл — отменяем удаление.
  cancelDeletion(id) {
    const timer = this.deletionTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.deletionTimers.delete(id);
    }
  }
}

function formatDuration(ms) {
  return ms >= 60_000 ? `${Math.round(ms / 60_000)} мин` : `${Math.round(ms / 1000)} сек`;
}
