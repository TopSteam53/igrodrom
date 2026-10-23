// Приглашения авторов: у каждого одобренного разработчика своя ссылка /developers?ref=<код>.
// Код ставит cookie на 60 дней; если по нему подают заявку, она запоминает пригласившего.
// Кабинет показывает, сколько авторов подали заявку и сколько из них одобрено. Наград пока нет.
import { createHmac } from 'node:crypto';

const COOKIE = 'devref';
const TTL_SEC = 60 * 24 * 3600;

export function createDevRef({ db, secret, secureCookies, cookies, send, requireDeveloper, siteUrl }) {
  const q = {
    approved: db.prepare("SELECT 1 FROM developer_applications WHERE user_id = ? AND status = 'approved'"),
    setReferrer: db.prepare('UPDATE developer_applications SET referred_by = ? WHERE user_id = ? AND referred_by IS NULL'),
    counts: db.prepare(`SELECT COUNT(*) AS invited, COALESCE(SUM(status = 'approved'), 0) AS approved
                        FROM developer_applications WHERE referred_by = ?`),
  };

  // Код — номер автора и подпись: подобрать чужой код перебором номеров не выйдет.
  const sig = (id) => createHmac('sha256', secret).update(`devref.${id}`).digest('hex').slice(0, 8);
  const codeOf = (id) => `${id.toString(36)}${sig(id)}`;
  function idOf(code) {
    const m = String(code || '').match(/^([0-9a-z]{1,7})([0-9a-f]{8})$/);
    if (!m) return null;
    const id = parseInt(m[1], 36);
    return sig(id) === m[2] && q.approved.get(id) ? id : null;
  }

  // Заголовок для страницы, открытой по ссылке с ?ref=.
  function cookieHeader(url) {
    const code = url.searchParams.get('ref');
    if (!code || !idOf(code)) return {};
    return { 'Set-Cookie': `${COOKIE}=${code}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL_SEC}${secureCookies ? '; Secure' : ''}` };
  }

  // Заявка подана: запоминаем, кто пригласил (один раз, себя пригласить нельзя).
  function remember(req, userId) {
    const from = idOf(cookies(req)[COOKIE]);
    if (from && from !== userId) q.setReferrer.run(from, userId);
  }

  function mine(req, res) {
    const user = requireDeveloper(req);
    const { invited, approved } = q.counts.get(user.id);
    send(res, 200, { link: `${siteUrl}/developers?ref=${codeOf(user.id)}`, invited, approved });
  }

  function route(p, m) {
    if (p === '/api/developer/referrals' && m === 'GET') return mine;
    return null;
  }

  return { route, cookieHeader, remember, idOf };
}
