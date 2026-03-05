#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

cd "$REPO_ROOT"

OUTPUT=$(node commands/check_mutation_budget.js \
    --max-files 3 \
    --max-lines 200 \
    --deny-prefix templates/ \
    --deny-prefix pipeline.json \
    --deny-prefix PROJECT_STATE.md || true)

echo "$OUTPUT"

OK_VALUE=$(echo "$OUTPUT" | node -e "let data=''; process.stdin.on('data',c=>data+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(data).ok===true?'true':'false')}catch(e){console.log('false')}})")

if [ "$OK_VALUE" = "true" ]; then
    exit 0
else
    exit 1
fi
