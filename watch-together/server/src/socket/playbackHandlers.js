import { parseVideoUrl } from '../playback/parseVideoUrl.js';
import { cleanPosition, reply } from './utils.js';

// Общий плеер: новое видео, play, пауза, перемотка.
export function registerPlaybackHandlers(io, socket, store) {
  // Комната и участник, от которого пришла команда (null, если он не в комнате).
  function getSender() {
    const room = store.get(socket.data.roomId);
    const participant = room?.getParticipant(socket.id);
    return participant ? { room, participant } : null;
  }

  function broadcastState(room) {
    io.to(room.id).emit('playback:state', room.playback.snapshot());
  }

  socket.on('playback:load', (payload, ack) => {
    const sender = getSender();
    if (!sender) return reply(ack, { ok: false, error: 'NOT_IN_ROOM' });

    const video = parseVideoUrl(payload?.url);
    if (!video) return reply(ack, { ok: false, error: 'INVALID_URL' });

    const { room, participant } = sender;
    room.playback.load(video, participant.nickname);
    broadcastState(room);

    const message = room.addMessage({ type: 'system', text: `${participant.nickname} ставит новое видео` });
    io.to(room.id).emit('chat:message', message);
    reply(ack, { ok: true });

    console.log(`[playback] ${room.id}: новое видео ${video.provider}/${video.videoId} — ${participant.nickname}`);
  });

  for (const type of ['play', 'pause', 'seek']) {
    socket.on(`playback:${type}`, (payload, ack) => {
      const sender = getSender();
      if (!sender) return reply(ack, { ok: false, error: 'NOT_IN_ROOM' });

      const position = cleanPosition(payload?.position);
      if (position === null) return reply(ack, { ok: false, error: 'INVALID_POSITION' });

      const { room, participant } = sender;
      const changed = room.playback.apply(type, position, participant.nickname);

      // Вторая линия защиты от петли: команду, которая ничего не меняет, никому не рассылаем.
      if (changed) {
        broadcastState(room);
        console.log(
          `[playback] ${room.id}: ${type} ${position.toFixed(1)} с — ${participant.nickname} (версия ${room.playback.revision})`,
        );
      }
      reply(ack, { ok: true, changed });
    });
  }
}
