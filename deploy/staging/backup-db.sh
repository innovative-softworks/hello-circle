#!/usr/bin/env bash
# HelloCircle STAGING — database backup (run before every migration and nightly).
# Uses a dedicated read-only backup account via ~/.my.cnf-style option file so no
# password appears on the command line or in process listings.
#   /srv/hellocircle-staging/shared/backup.cnf  (mode 0600):
#     [client]
#     user=hc_staging_backup
#     password=...
set -euo pipefail
DB_NAME="${DB_NAME:-hello_circle_staging}"
case "$DB_NAME" in hello_circle|hello_circle_dev) echo "refusing: $DB_NAME is not a staging database" >&2; exit 1;; esac
BACKUP_DIR="${BACKUP_DIR:-/srv/hellocircle-staging/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/${DB_NAME}-${stamp}.sql.gz"
umask 077
mkdir -p "$BACKUP_DIR"
mysqldump --defaults-extra-file=/srv/hellocircle-staging/shared/backup.cnf \
  --single-transaction --routines --triggers --no-tablespaces "$DB_NAME" | gzip -9 > "$out"
gzip -t "$out"
echo "backup written: $out ($(du -h "$out" | cut -f1))"
find "$BACKUP_DIR" -name "${DB_NAME}-*.sql.gz" -mtime +"$KEEP_DAYS" -delete
