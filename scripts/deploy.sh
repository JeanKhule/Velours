#!/usr/bin/env bash
# Publishes dist/ to the gh-pages branch (GitHub Pages "deploy from branch").
# Uses this repo's own credentials (pinned to the dedicated account) and the anonymous "bm" author.
set -euo pipefail
cd "$(dirname "$0")/.."
npx vite build --logLevel error
export GIT_INDEX_FILE=.git/deploy-index
rm -f "$GIT_INDEX_FILE"
git --work-tree=dist add -A
tree=$(git write-tree)
commit=$(git commit-tree "$tree" -m "Publication")
rm -f "$GIT_INDEX_FILE"
git push -f origin "$commit:refs/heads/gh-pages"
