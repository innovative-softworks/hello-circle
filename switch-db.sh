#!/usr/bin/env bash
# Switches server/.env between the two local databases documented in
# CLAUDE.md:
#   dev  -> hello_circle_dev   (safe to reset/reseed freely, the default)
#   prod -> hello_circle       (real/canonical data — never point routine
#                                dev work at it)
#
# Usage:
#   ./switch-db.sh dev      # point server/.env at hello_circle_dev
#   ./switch-db.sh prod     # point server/.env at hello_circle (asks to confirm)
#   ./switch-db.sh status   # show which DB server/.env currently points at (default)
#
# Source files (never modified by this script, only copied FROM):
#   server/.env.development  — dev config
#   server/.env.production   — prod config
#
# Whatever server/.env pointed at before a switch is backed up to
# server/.env-backups/ first, so nothing is ever silently lost.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/server"

ENV_FILE=".env"
BACKUP_DIR=".env-backups"

current_db_name() {
  if [ -f "$ENV_FILE" ]; then
    grep -E "^DB_NAME=" "$ENV_FILE" | cut -d= -f2
  else
    echo "(none — server/.env doesn't exist)"
  fi
}

show_status() {
  echo "server/.env currently points at: DB_NAME=$(current_db_name)"
}

backup_current_env() {
  if [ -f "$ENV_FILE" ]; then
    mkdir -p "$BACKUP_DIR"
    local stamp
    stamp="$(date +%Y%m%d-%H%M%S)"
    cp "$ENV_FILE" "$BACKUP_DIR/.env.$stamp.bak"
    echo "Backed up previous server/.env -> server/$BACKUP_DIR/.env.$stamp.bak"
  fi
}

switch_to() {
  local target_name="$1" source_file="$2"
  if [ ! -f "$source_file" ]; then
    echo "server/$source_file not found — nothing to switch to." >&2
    exit 1
  fi
  if [ -f "$ENV_FILE" ] && [ "$(current_db_name)" = "$target_name" ]; then
    echo "Already on $target_name — nothing to do."
    show_status
    return
  fi
  backup_current_env
  cp "$source_file" "$ENV_FILE"
  show_status
}

case "${1:-status}" in
  status)
    show_status
    ;;
  dev)
    switch_to "hello_circle_dev" ".env.development"
    ;;
  prod)
    echo "############################################################"
    echo "#  WARNING: switching server/.env to PROD (hello_circle)   #"
    echo "#  Real/canonical data. Do not run reset-demo against it.  #"
    echo "############################################################"
    read -r -p "Type 'prod' to confirm: " confirm
    if [ "$confirm" != "prod" ]; then
      echo "Aborted — server/.env left unchanged."
      exit 1
    fi
    switch_to "hello_circle" ".env.production"
    ;;
  *)
    echo "Usage: $0 [dev|prod|status]" >&2
    exit 1
    ;;
esac
