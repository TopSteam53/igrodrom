import { randomInt } from 'node:crypto';

// Без похожих символов (0/o, 1/l/i), чтобы id было легко прочитать и продиктовать.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function generateId(length = 8) {
  let id = '';
  for (let i = 0; i < length; i++) {
    id += ALPHABET[randomInt(ALPHABET.length)];
  }
  return id;
}
