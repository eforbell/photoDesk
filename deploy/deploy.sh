#!/usr/bin/env bash
# deploy.sh — simple git-based deploy for PhotoDesk
# Usage:
#   ./deploy/deploy.sh                 # deploy main
#   ./deploy/deploy.sh feat/my-branch  # deploy a branch
#   ./deploy/deploy.sh --restore-stash # restore last auto-stashed changes
# Env:
#   APP_DIR=/data/apps/photoDesk
#   REPO_URL=git@github.com:eforbell/photoDesk.git
#   SERVICE_NAME=photodesk
#   AUTO_STASH=1                       # default; stash local changes before deploy
#   AUTO_STASH=0                       # fail on local changes instead
#   FORCE_DEPLOY=1                     # skip dirty-check (not recommended)

set -euo pipefail

APP_DIR="${APP_DIR:-/data/apps/photoDesk}"
REPO_URL="${REPO_URL:-git@github.com:eforbell/photoDesk.git}"
SERVICE="${SERVICE_NAME:-photodesk}"
BRANCH="${1:-main}"
REMOTE_BRANCH="${BRANCH#origin/}"
STASH_REF_FILE="$APP_DIR/.deploy-last-stash-ref"

restore_stash() {
  local stash_ref="${1:-}"
  if [[ ! -d "$APP_DIR/.git" ]]; then
    echo "ERROR: $APP_DIR is not a git checkout."
    exit 1
  fi
  if [[ -z "$stash_ref" ]]; then
    if [[ -f "$STASH_REF_FILE" ]]; then
      stash_ref="$(cat "$STASH_REF_FILE")"
    else
      echo "ERROR: No saved stash ref found."
      exit 1
    fi
  fi

  echo "==> Restoring stash: $stash_ref"
  git -C "$APP_DIR" stash pop "$stash_ref"
  rm -f "$STASH_REF_FILE"
  echo "==> Local changes restored."
}

if [[ "$BRANCH" == "--restore-stash" ]]; then
  restore_stash "${2:-}"
  exit 0
fi

echo "==> PhotoDesk deploy: $BRANCH"

if [[ ! -d "$APP_DIR/.git" ]]; then
  if [[ -e "$APP_DIR" && -n "$(find "$APP_DIR" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
    echo "ERROR: $APP_DIR exists but is not an empty directory or git checkout."
    exit 1
  fi
  echo "==> Cloning $REPO_URL"
  mkdir -p "$(dirname "$APP_DIR")"
  git clone --branch "$REMOTE_BRANCH" "$REPO_URL" "$APP_DIR"
else
  AUTO_STASH="${AUTO_STASH:-1}"
  if [[ -z "${FORCE_DEPLOY:-}" && -n "$(git -C "$APP_DIR" status --porcelain)" ]]; then
    if [[ "$AUTO_STASH" == "1" ]]; then
      stamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      stash_msg="deploy:auto-stash:${stamp}:${BRANCH}"
      echo "==> Local changes detected; auto-stashing before deploy"
      git -C "$APP_DIR" stash push --include-untracked -m "$stash_msg" >/dev/null
      stash_ref="$(git -C "$APP_DIR" rev-parse -q --verify refs/stash || true)"
      if [[ -n "$stash_ref" ]]; then
        echo "$stash_ref" > "$STASH_REF_FILE"
        echo "==> Saved stash ref: $stash_ref"
        echo "==> Restore later with: ./deploy/deploy.sh --restore-stash"
      fi
    else
      echo "ERROR: Uncommitted local changes. Commit/stash first, or set AUTO_STASH=1."
      exit 1
    fi
  fi

  echo "==> Pulling origin/$REMOTE_BRANCH"
  git -C "$APP_DIR" fetch origin --prune
  git -C "$APP_DIR" checkout -B deploy-current "origin/$REMOTE_BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$REMOTE_BRANCH"
fi

cd "$APP_DIR"

if [[ ! -f .env ]]; then
  echo "WARNING: $APP_DIR/.env not found. Create one with Immich credentials before starting $SERVICE."
fi

echo "==> Installing production dependencies"
npm ci --omit=dev

echo "==> Checking configured HEIC decode mode"
npm run check:heic

DB_PATH="$(node -e "
  require('dotenv').config();
  const path = require('path');
  console.log(process.env.PHOTODESK_DB_PATH
    ? path.resolve(process.env.PHOTODESK_DB_PATH)
    : path.join(process.cwd(), 'photodesk.db'));
")"
SERVICE_WAS_ACTIVE=0
if sudo systemctl is-active --quiet "$SERVICE"; then
  SERVICE_WAS_ACTIVE=1
  echo "==> Stopping $SERVICE before SQLite migration"
  sudo systemctl stop "$SERVICE"
fi

if [[ -f "$DB_PATH" ]]; then
  BACKUP_DIR="${PHOTODESK_BACKUP_DIR:-$(dirname "$DB_PATH")/backups}"
  mkdir -p "$BACKUP_DIR"
  BACKUP_PATH="$BACKUP_DIR/$(basename "$DB_PATH").$(date -u +%Y%m%dT%H%M%SZ).bak"
  echo "==> Backing up SQLite database to $BACKUP_PATH"
  cp -p "$DB_PATH" "$BACKUP_PATH"
fi

echo "==> Running database migrations"
if ! npm run migrate; then
  echo "ERROR: Database migration failed."
  if [[ -n "${BACKUP_PATH:-}" ]]; then
    echo "Database backup retained at: $BACKUP_PATH"
  fi
  if [[ "$SERVICE_WAS_ACTIVE" == "1" ]]; then
    echo "The service remains stopped to avoid running against a partial migration."
  fi
  exit 1
fi

echo "==> Restarting $SERVICE"
sudo systemctl restart "$SERVICE"
sudo systemctl status "$SERVICE" --no-pager -l

echo "==> Done."
