import { nicknameColor } from '../lib/nickname.js';

export default function ParticipantList({ participants, selfId }) {
  return (
    <section className="panel participants">
      <h2 className="panel__title">
        Онлайн <span className="counter">{participants.length}</span>
      </h2>
      <ul className="participants__list">
        {participants.map((participant) => (
          <li key={participant.id} className="participant">
            <span className="avatar" style={{ background: nicknameColor(participant.nickname) }}>
              {[...participant.nickname][0].toUpperCase()}
            </span>
            <span className="participant__name">{participant.nickname}</span>
            {participant.id === selfId && <span className="participant__you">вы</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
