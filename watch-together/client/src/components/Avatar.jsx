import { nicknameColor } from '../lib/nickname.js';

export default function Avatar({ name }) {
  return (
    <span className="avatar" style={{ background: nicknameColor(name) }} aria-hidden="true">
      {[...name][0].toUpperCase()}
    </span>
  );
}
