import Avatar from './Avatar.jsx';

export default function ParticipantList({ participants, selfId, className = '' }) {
  return (
    <section className={`people ${className}`} aria-label="Участники">
      <h2 className="side-title">
        В комнате <span className="side-title__count">{participants.length}</span>
      </h2>
      <ul className="people__list">
        {participants.map((participant) => (
          <li key={participant.id} className="person">
            <Avatar name={participant.nickname} />
            <span className="person__name">{participant.nickname}</span>
            {participant.id === selfId && <span className="person__me">вы</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
