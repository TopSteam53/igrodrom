#!/bin/sh
# Первичная настройка VPS (Ubuntu 22.04/24.04): Docker, сайт из GitHub, HTTPS (Caddy), файрвол, бэкапы базы.
# Повторный запуск безопасен: обновляет код и пересобирает сайт, .env не трогает.
#
#   sh server-setup.sh <домен> <почта владельца> [ветка]
#
# Без своего домена подойдёт адрес по IP: 1.2.3.4 → 1-2-3-4.sslip.io (HTTPS выпустится сам).
set -eu

DOMAIN="${1:?укажите домен, например 1-2-3-4.sslip.io}"
ADMIN="${2:?укажите почту владельца}"
BRANCH="${3:-main}"
DIR=/opt/igrodrom
REPO=https://github.com/TopSteam53/igrodrom.git
export DEBIAN_FRONTEND=noninteractive

# 1 ГБ памяти мало для сборки образа: добавляем файл подкачки.
if ! swapon --show | grep -q .; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Docker из репозитория Ubuntu: не зависит от доступности download.docker.com.
apt-get update -qq
apt-get install -y -qq git ca-certificates ufw docker.io docker-compose-v2 >/dev/null
# Docker Hub из России открывается не всегда — образы тянем через зеркало Google.
if [ ! -f /etc/docker/daemon.json ]; then
  echo '{"registry-mirrors": ["https://mirror.gcr.io"], "log-opts": {"max-size": "10m", "max-file": "3"}}' > /etc/docker/daemon.json
  systemctl restart docker
fi
systemctl enable --now docker >/dev/null

ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null

if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q origin "$BRANCH" && git -C "$DIR" checkout -q "$BRANCH" && git -C "$DIR" reset -q --hard "origin/$BRANCH"
else
  git clone -q -b "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR"

if [ ! -f .env ]; then
  cp .env.example .env
  # Шаблонные контакты и SMTP из примера не годятся: оставляем пустыми, пока не заданы настоящие.
  sed -i -e "s|^DOMAIN=.*|DOMAIN=$DOMAIN|" -e "s|^ADMIN_EMAILS=.*|ADMIN_EMAILS=$ADMIN|" \
    -e 's|^SMTP_URL=.*|SMTP_URL=|' -e 's|^MAIL_FROM=.*|MAIL_FROM=|' -e "s|^SITE_URL=.*|SITE_URL=https://$DOMAIN|" \
    -e 's|^SITE_EMAIL=.*|SITE_EMAIL=|' -e 's|^SITE_TELEGRAM=.*|SITE_TELEGRAM=|' -e 's|^SITE_OWNER=.*|SITE_OWNER=|' .env
  chmod 600 .env
fi

docker compose up -d --build
docker image prune -f >/dev/null

# Ежедневная копия базы и загруженных игр в 04:30.
install -m 755 scripts/backup.sh /usr/local/bin/igrodrom-backup
echo '30 4 * * * root /usr/local/bin/igrodrom-backup >> /var/log/igrodrom-backup.log 2>&1' > /etc/cron.d/igrodrom-backup

echo "Готово: https://$DOMAIN"
