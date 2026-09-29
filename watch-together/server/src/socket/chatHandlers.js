import { cleanMessageText, reply } from './utils.js';

// Сообщения чата.
export function registerChatHandlers(io, socket, store) {
  socket.on('chat:send', (payload, ack) => {
    const room = store.get(socket.data.roomId);
    const author = room?.getParticipant(socket.id);
    if (!author) return reply(ack, { ok: false, error: 'NOT_IN_ROOM' });

    const text = cleanMessageText(payload?.text);
    if (!text) return reply(ack, { ok: false, error: 'INVALID_MESSAGE' });

    const message = room.addMessage({
      type: 'user',
      text,
      author: { id: author.id, nickname: author.nickname },
    });
    io.to(room.id).emit('chat:message', message);
    reply(ack, { ok: true });
  });
}
