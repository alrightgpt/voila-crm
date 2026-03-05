#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

RECEIPT=""
RESULT=""
NOW=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --receipt) RECEIPT="$2"; shift 2 ;;
    --result) RESULT="$2"; shift 2 ;;
    --now) NOW="$2"; shift 2 ;;
    *) shift ;;
  esac
done

if [[ -z "$RECEIPT" || -z "$RESULT" || -z "$NOW" ]]; then
  echo '{"ok":false,"code":"INVALID_ARGS","message":"Missing required args: --receipt, --result, --now","details":{}}'
  exit 2
fi

node scripts/phase_runner.js --receipt "$RECEIPT" --append-result "$RESULT" --now "$NOW"
