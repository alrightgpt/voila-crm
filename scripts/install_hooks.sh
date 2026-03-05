#!/bin/bash
#
# scripts/install_hooks.sh
# Installs git hooks from scripts/hooks/ to .git/hooks/
# Handles both regular repos and git submodules
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# Verify we're in a git repo root
GIT_TOPLEVEL="$(git rev-parse --show-toplevel 2>/dev/null || true)"

if [ -z "$GIT_TOPLEVEL" ]; then
    echo "ERROR: Not in a git repository"
    exit 1
fi

if [ "$GIT_TOPLEVEL" != "$REPO_ROOT" ]; then
    echo "ERROR: Must run from git repository root"
    echo "  Git toplevel: $GIT_TOPLEVEL"
    echo "  Script dir parent: $REPO_ROOT"
    exit 1
fi

# Determine actual git directory (handles submodules)
# .git can be a file (submodule) or directory (regular repo)
if [ -f "$REPO_ROOT/.git" ]; then
    # Submodule: .git is a file pointing to the actual git dir
    GIT_DIR="$(git rev-parse --git-dir)"
else
    # Regular repo: .git is the directory
    GIT_DIR="$REPO_ROOT/.git"
fi

# Ensure hooks directory exists
HOOKS_DIR="$GIT_DIR/hooks"
mkdir -p "$HOOKS_DIR"

# Install pre-commit hook
SOURCE="$SCRIPT_DIR/hooks/pre-commit"
DEST="$HOOKS_DIR/pre-commit"

if [ ! -f "$SOURCE" ]; then
    echo "ERROR: Hook source not found: $SOURCE"
    exit 1
fi

cp "$SOURCE" "$DEST"
chmod +x "$DEST"

echo "Installed pre-commit hook to: $DEST"
echo "Done"
