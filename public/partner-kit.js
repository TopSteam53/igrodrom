// Баннеры для блогера: плашка в угол видео, баннер 16:9 и квадрат — с его промокодом. Рисуются в canvas прямо
// в браузере (шрифты сайта, обложки игр с этого же сайта), блогер скачивает PNG. Используются в кабинете /partner.
(function () {
  const Y = '#FFC531', NAVY = '#1C2140', BG = '#12162b', SUB = '#c9cdea';
  const LOGO_ARC = new Path2D('M22.6 9.4A9 9 0 1 0 25 16');
  const LOGO_TRI = new Path2D('M14.6 12.2 21.2 16l-6.6 3.8z');

  const fontsReady = () => Promise.all([
    document.fonts.load('800 40px Unbounded', 'АаZz'), document.fonts.load('700 40px Onest', 'АаZz'), document.fonts.load('500 40px Onest', 'АаZz'),
  ]).catch(() => {});
  const loadImg = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });

  function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
  function logo(ctx, x, y, size) {
    ctx.save(); ctx.translate(x, y); ctx.scale(size / 32, size / 32);
    rrect(ctx, 0, 0, 32, 32, 9); ctx.fillStyle = Y; ctx.fill();
    ctx.strokeStyle = NAVY; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = 4.2; ctx.stroke(LOGO_ARC);
    ctx.fillStyle = NAVY; ctx.lineWidth = 1.4; ctx.fill(LOGO_TRI); ctx.stroke(LOGO_TRI);
    ctx.restore();
  }
  // Картинка «как object-fit: cover» в скруглённой рамке.
  function cover(ctx, img, x, y, w, h, r) {
    ctx.save(); rrect(ctx, x, y, w, h, r); ctx.clip();
    if (img) {
      const s = Math.max(w / img.width, h / img.height);
      ctx.drawImage(img, x + (w - img.width * s) / 2, y + (h - img.height * s) / 2, img.width * s, img.height * s);
    } else { ctx.fillStyle = '#2a2f63'; ctx.fillRect(x, y, w, h); }
    ctx.restore();
  }
  const font = (w, px, fam) => `${w} ${px}px ${fam === 'd' ? 'Unbounded, Onest, sans-serif' : 'Onest, system-ui, sans-serif'}`;
  // Текст, ужатый до ширины: шрифт уменьшается, пока строка не влезет.
  function fit(ctx, text, maxW, w, px, fam) {
    let size = px;
    ctx.font = font(w, size, fam);
    while (size > 10 && ctx.measureText(text).width > maxW) { size -= 2; ctx.font = font(w, size, fam); }
    return size;
  }

  // Плашка: логотип, «Играй бесплатно / playgamely.ru», жёлтый блок с промокодом. h — высота, ширина по тексту.
  function plateSize(ctx, promo, h) {
    ctx.font = font(800, h * 0.21, 'd'); const t1 = ctx.measureText('Играй бесплатно').width;
    ctx.font = font(700, h * 0.18, 't'); const t2 = ctx.measureText('playgamely.ru').width;
    ctx.font = font(800, h * 0.24, 'd'); const t3 = Math.max(ctx.measureText(promo).width, h * 1.1);
    const pad = h * 0.14, logoS = h * 0.62;
    const promoW = t3 + h * 0.36;
    return { w: pad + logoS + pad * 0.9 + Math.max(t1, t2) + pad + promoW + pad, pad, logoS, promoW };
  }
  function plate(ctx, x, y, h, promo, bonus) {
    const { w, pad, logoS, promoW } = plateSize(ctx, promo, h);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = h * 0.18; ctx.shadowOffsetY = h * 0.05;
    rrect(ctx, x, y, w, h, h * 0.2); ctx.fillStyle = 'rgba(18,22,43,.94)'; ctx.fill();
    ctx.restore();
    logo(ctx, x + pad, y + (h - logoS) / 2, logoS);
    const tx = x + pad + logoS + pad * 0.9;
    ctx.fillStyle = '#fff'; ctx.font = font(800, h * 0.21, 'd'); ctx.textBaseline = 'alphabetic';
    ctx.fillText('Играй бесплатно', tx, y + h * 0.45);
    ctx.fillStyle = Y; ctx.font = font(700, h * 0.18, 't');
    ctx.fillText('playgamely.ru', tx, y + h * 0.72);
    // Промокод
    const px = x + w - pad - promoW, py = y + pad * 0.8, ph = h - pad * 1.6;
    rrect(ctx, px, py, promoW, ph, h * 0.13); ctx.fillStyle = Y; ctx.fill();
    ctx.fillStyle = NAVY; ctx.textAlign = 'center';
    ctx.font = font(700, h * 0.1, 't'); ctx.fillText('ПРОМОКОД', px + promoW / 2, py + ph * 0.27);
    fit(ctx, promo, promoW - h * 0.2, 800, h * 0.24, 'd'); ctx.fillText(promo, px + promoW / 2, py + ph * 0.66);
    ctx.font = font(700, h * 0.085, 't'); ctx.fillText(`+${bonus} монеток`, px + promoW / 2, py + ph * 0.9);
    ctx.textAlign = 'left';
    return w;
  }

  // Фон баннеров: тёмный градиент и мягкое жёлтое свечение.
  function backdrop(ctx, W, H) {
    const g = ctx.createRadialGradient(W * 0.8, H * 0.4, 0, W * 0.8, H * 0.4, W * 0.75);
    g.addColorStop(0, '#2a2f63'); g.addColorStop(0.55, '#161a36'); g.addColorStop(1, '#0f1228');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  function promoPill(ctx, x, y, promo, bonus, size) {
    const label = `Промокод ${promo}`;
    ctx.font = font(800, size, 'd'); const w1 = ctx.measureText(label).width;
    ctx.font = font(700, size * 0.8, 't'); const w2 = ctx.measureText(`+${bonus} монеток`).width;
    const pad = size * 0.7, w = pad + w1 + pad * 0.8 + w2 + pad, h = size * 2.1;
    rrect(ctx, x, y, w, h, h / 2); ctx.fillStyle = Y; ctx.fill();
    ctx.fillStyle = NAVY; ctx.font = font(800, size, 'd'); ctx.fillText(label, x + pad, y + h * 0.66);
    ctx.font = font(700, size * 0.8, 't'); ctx.globalAlpha = 0.75; ctx.fillText(`+${bonus} монеток`, x + pad + w1 + pad * 0.8, y + h * 0.64); ctx.globalAlpha = 1;
  }

  const KINDS = {
    // Прозрачный кадр 1920×1080 с плашкой в правом нижнем углу — кладётся поверх видео целиком.
    overlay: { w: 1920, h: 1080, title: 'Плашка поверх видео', sub: '1920×1080, прозрачный фон — положите на дорожку над видео',
      draw(ctx, d) { const h = 170; const { w } = plateSize(ctx, d.promo, h); plate(ctx, 1920 - 56 - w, 1080 - 56 - h, h, d.promo, d.bonus); } },
    // Одна плашка без кадра — для монтажа, когда её двигают и масштабируют сами.
    plate: { w: 0, h: 260, title: 'Плашка отдельно', sub: 'прозрачный фон — двигайте и масштабируйте в монтаже',
      size(ctx, d) { return plateSize(ctx, d.promo, 220).w + 40; },
      draw(ctx, d) { plate(ctx, 20, 20, 220, d.promo, d.bonus); } },
    banner: { w: 1280, h: 720, title: 'Баннер 16:9', sub: '1280×720 — заставка в конце видео, пост, описание стрима',
      draw(ctx, d) {
        backdrop(ctx, 1280, 720);
        const imgs = d.covers;
        [[700, 70, 4], [610, 255, -3], [690, 440, 3]].forEach(([x, y, deg], i) => {
          ctx.save(); ctx.translate(x + 240, y + 135); ctx.rotate((deg * Math.PI) / 180);
          ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18;
          rrect(ctx, -240, -135, 480, 270, 20); ctx.fillStyle = '#000'; ctx.fill(); ctx.shadowColor = 'transparent';
          cover(ctx, imgs[i % Math.max(1, imgs.length)], -240, -135, 480, 270, 20);
          ctx.restore();
        });
        logo(ctx, 72, 70, 60);
        ctx.fillStyle = '#fff'; ctx.font = font(800, 32, 'd'); ctx.fillText('Gamely', 148, 112);
        ctx.font = font(800, 66, 'd'); ctx.fillText('Играй', 72, 250); ctx.fillText('бесплатно', 72, 326);
        ctx.fillStyle = Y; ctx.fillText('в браузере', 72, 402);
        ctx.fillStyle = SUB; fit(ctx, 'Без скачивания, на телефоне и ПК', 500, 500, 28, 't'); ctx.fillText('Без скачивания, на телефоне и ПК', 72, 456);
        promoPill(ctx, 72, 510, d.promo, d.bonus, 30);
        ctx.fillStyle = '#fff'; ctx.font = font(700, 30, 't'); ctx.fillText('playgamely.ru', 72, 650);
      } },
    square: { w: 1080, h: 1080, title: 'Квадрат', sub: '1080×1080 — Shorts, ТикТок, посты',
      draw(ctx, d) {
        backdrop(ctx, 1080, 1080);
        const imgs = d.covers;
        cover(ctx, imgs[0], 60, 60, 960, 540, 28);
        if (imgs[1]) cover(ctx, imgs[1], 60, 620, 470, 160, 20);
        if (imgs[2]) cover(ctx, imgs[2], 550, 620, 470, 160, 20);
        logo(ctx, 60, 830, 84);
        ctx.fillStyle = '#fff'; fit(ctx, 'Играй бесплатно', 860, 800, 62, 'd'); ctx.fillText('Играй бесплатно', 170, 885);
        ctx.fillStyle = Y; ctx.font = font(700, 36, 't'); ctx.fillText('playgamely.ru', 172, 932);
        promoPill(ctx, 60, 965, d.promo, d.bonus, 30);
      } },
  };

  async function render(kind, data) {
    await fontsReady();
    const k = KINDS[kind];
    const c = document.createElement('canvas');
    const probe = c.getContext('2d');
    c.width = k.size ? Math.ceil(k.size(probe, data)) : k.w; c.height = k.h;
    const ctx = c.getContext('2d');
    k.draw(ctx, data);
    return c;
  }
  async function covers(urls) { return (await Promise.all(urls.slice(0, 3).map(loadImg))).filter(Boolean); }

  window.PartnerKit = { KINDS, render, covers };
})();
