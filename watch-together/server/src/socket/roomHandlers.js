import { cleanNickname, reply } from './utils.js';

// Вход в комнату, смена ника и выход (закрытие вкладки / потеря связи).
export function registerRoomHandlers(io, socket, store) {
  socket.on('room:join', (payload, ack) => {
    const nickname = cleanNickname(payload?.nickname);
    if (!nickname) return reply(ack, { ok: false, error: 'INVALID_NICKNAME' });

    const room = typeof payload?.roomId === 'string' ? store.get(payload.roomId) : null;
    if (!room) return reply(ack, { ok: false, error: 'ROOM_NOT_FOUND' });

    // Если этот сокет уже был в какой-то комнате — сначала выходим из неё.
    leaveCurrentRoom(io, socket, store);

    const participant = room.addParticipant(socket.id, nickname);
    store.cancelDeletion(room.id);
    socket.join(room.id);
    socket.data.roomId = room.id;

    const systemMessage = room.addMessage({ type: 'system', text: `${nickname} заходит в комнату` });

    // Новичку — всё состояние комнаты сразу, остальным — только изменения.
    // Позицию видео сервер пересчитывает на текущий момент (см. PlaybackState.snapshot).
    reply(ack, {
      ok: true,
      self: participant,
      participants: room.getParticipants(),
      messages: room.messages,
      playback: room.playback.snapshot(),
    });
    socket.to(room.id).emit('chat:message', systemMessage);
    socket.to(room.id).emit('room:participants', room.getParticipants());

    console.log(`[rooms] ${nickname} вошёл(ла) в ${room.id} (онлайн: ${room.participants.size})`);
  });

  socket.on('room:rename', (payload, ack) => {
    const nickname = cleanNickname(payload?.nickname);
    if (!nickname) return reply(ack, { ok: false, error: 'INVALID_NICKNAME' });

    const room = store.get(socket.data.roomId);
    const participant = room?.getParticipant(socket.id);
    if (!participant) return reply(ack, { ok: false, error: 'NOT_IN_ROOM' });

    const oldNickname = participant.nickname;
    if (oldNickname === nickname) return reply(ack, { ok: true, self: participant });

    participant.nickname = nickname;
    const systemMessage = room.addMessage({ type: 'system', text: `${oldNickname} теперь ${nickname}` });

    reply(ack, { ok: true, self: participant });
    io.to(room.id).emit('chat:message', systemMessage);
    io.to(room.id).emit('room:participants', room.getParticipants());
  });

  // Срабатывает, когда вкладку закрыли, ушли со страницы комнаты или пропала связь.
  socket.on('disconnect', () => {
    leaveCurrentRoom(io, socket, store);
  });
}

function leaveCurrentRoom(io, socket, store) {
  const roomId = socket.data.roomId;
  if (!roomId) return;

  socket.data.roomId = null;
  socket.leave(roomId);

  const room = store.get(roomId);
  const participant = room?.removeParticipant(socket.id);
  if (!participant) return;

  const systemMessage = room.addMessage({ type: 'system', text: `${participant.nickname} выходит из комнаты` });
  io.to(roomId).emit('chat:message', systemMessage);
  io.to(roomId).emit('room:participants', room.getParticipants());

  console.log(`[rooms] ${participant.nickname} вышел(ла) из ${roomId} (онлайн: ${room.participants.size})`);

  if (room.isEmpty) {
    // Никто не смотрит — ставим на паузу, чтобы вернувшиеся продолжили с того же места.
    room.playback.apply('pause', room.playback.getPosition(), null);
    store.scheduleDeletion(roomId);
  }
}
