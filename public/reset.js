/* global Igr */
(() => {
  const { $, esc } = Igr;
  const token = new URLSearchParams(location.search).get('token');
  if (token) history.replaceState(null, '', location.pathname);
  $('ask').classList.toggle('hidden', !!token);
  $('set').classList.toggle('hidden', !token);
  let requestedEmail = '', resendAt = 0, resending = false;

  async function post(url, body) {
    let r;
    try { r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
    catch { throw new Error('Не удалось связаться с сайтом. Проверьте соединение и попробуйте ещё раз.'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Сервис временно недоступен. Попробуйте позже.');
    return data;
  }
  function countdown() {
    const left = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
    $('resend').disabled = left > 0 || resending;
    $('resend').textContent = left ? `Отправить ещё раз через ${left} с` : 'Отправить ещё раз';
  }
  function accepted() {
    resendAt = Date.now() + 60000;
    countdown();
    $('sentText').innerHTML = `Если аккаунт с адресом <b>${esc(requestedEmail)}</b> существует, на него придёт письмо со ссылкой. Она действует час.`;
  }
  $('ask').onsubmit = async (e) => {
    e.preventDefault();
    $('askErr').textContent = ''; $('askBtn').disabled = true; $('askBtn').textContent = 'Отправляем запрос';
    requestedEmail = $('email').value.trim();
    try {
      await post('/api/password/forgot', { email: requestedEmail });
      accepted(); $('ask').classList.add('hidden'); $('sent').classList.remove('hidden'); $('sent').focus();
    } catch (err) { $('askErr').textContent = err.message; }
    finally { $('askBtn').disabled = false; $('askBtn').textContent = 'Отправить ссылку'; }
  };
  $('resend').onclick = async () => {
    if (Date.now() < resendAt || resending) return;
    resending = true;
    $('resend').disabled = true; $('resendErr').textContent = '';
    try { await post('/api/password/forgot', { email: requestedEmail }); accepted(); }
    catch (err) { $('resendErr').textContent = err.message; }
    finally { resending = false; countdown(); }
  };
  setInterval(countdown, 1000);
  $('showPassword').onclick = () => {
    const show = $('password').type === 'password';
    for (const id of ['password', 'passwordConfirm']) $(id).type = show ? 'text' : 'password';
    $('showPassword').setAttribute('aria-pressed', String(show));
    $('showPassword').textContent = show ? 'Скрыть пароль' : 'Показать пароль';
  };
  $('set').onsubmit = async (e) => {
    e.preventDefault(); $('setErr').textContent = '';
    if ($('password').value !== $('passwordConfirm').value) {
      $('setErr').textContent = 'Пароли не совпадают. Проверьте оба поля.'; $('passwordConfirm').focus(); return;
    }
    $('setBtn').disabled = true; $('setBtn').textContent = 'Сохраняем пароль';
    try {
      await post('/api/password/reset', { token, password: $('password').value });
      location.replace('account.html');
    } catch (err) { $('setErr').textContent = err.message; $('setBtn').disabled = false; $('setBtn').textContent = 'Сохранить пароль'; }
  };
  if (!token) fetch('/api/password/status').then((r) => r.ok ? r.json() : null).then((s) => {
    if (s && !s.enabled) { $('serviceNote').textContent = 'Отправка писем пока не подключена. Восстановление пароля временно недоступно.'; $('serviceNote').classList.remove('hidden'); }
  }).catch(() => {});
  Igr.initHeader();
})();
