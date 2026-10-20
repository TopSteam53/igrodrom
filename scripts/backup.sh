#!/bin/sh
# Копия базы и файлов игр без остановки сайта. Ставится server-setup.sh в cron, хранит 14 последних дней.
# База копируется через VACUUM INTO — целостный снимок даже во время записи.
# Храните копии и вне сервера: scp root@сервер:/var/backups/igrodrom/* .
set -eu
DIR=/opt/igrodrom
OUT=/var/backups/igrodrom
STAMP=$(date +%F)
mkdir -p "$OUT"
cd "$DIR"

docker compose exec -T app node --disable-warning=ExperimentalWarning -e "
  const fs = require('node:fs');
  const { DatabaseSync } = require('node:sqlite');
  const file = '/data/backup.db';
  fs.rmSync(file, { force: true });
  new DatabaseSync('/data/igrodrom.db').exec(\"VACUUM INTO '\" + file + \"'\");
"
docker compose cp app:/data/backup.db "$OUT/igrodrom-$STAMP.db"
docker compose exec -T app rm -f /data/backup.db
docker compose exec -T app tar czf - -C /data games preview-secret > "$OUT/files-$STAMP.tgz"

find "$OUT" -type f -mtime +14 -delete
echo "$(date '+%F %T') копия готова: $(du -sh "$OUT" | cut -f1) в $OUT"
