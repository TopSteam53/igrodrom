import { Link } from 'react-router';

// Логотип: два пересекающихся круга — «вы» и «друзья».
export default function Wordmark() {
  return (
    <Link to="/" className="wordmark" aria-label="Смотрим вместе — на главную">
      <svg className="wordmark__mark" viewBox="0 0 26 16" aria-hidden="true">
        <circle className="wordmark__dot" cx="8" cy="8" r="7" />
        <circle className="wordmark__ring" cx="18" cy="8" r="6.25" />
      </svg>
      <span>смотрим вместе</span>
    </Link>
  );
}
