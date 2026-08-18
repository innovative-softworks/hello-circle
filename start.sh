#!/usr/bin/env bash
# Convenience launcher for macOS/Linux — starts the API (:3001) and the
# Vite client (:5173) together via the root "dev" script. Mirrors
# start.bat (the Windows equivalent). Dev-only, not part of the
# build/deploy path — see CLAUDE.md.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if [ ! -d node_modules ] || [ ! -d client/node_modules ] || [ ! -d server/node_modules ]; then
  echo "Installing dependencies (first run)..."
  npm install
fi

if [ ! -f server/.env ]; then
  echo "server/.env not found." >&2
  echo "Create it first (see README's Environment variables table), or run:" >&2
  echo "  ./switch-db.sh dev" >&2
  exit 1
fi

echo "Starting Hello Circle (API :3001 + client :5173)..."
echo "Database: $(grep -E '^DB_NAME=' server/.env | cut -d= -f2)"
npm run dev
