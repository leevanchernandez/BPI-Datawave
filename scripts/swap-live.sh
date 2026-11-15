#!/usr/bin/env bash
# Copies the /preview page over /live. Run from app/, then deploy with npx wrangler deploy.
set -euo pipefail
cd "$(dirname "$0")/../frontend"
sed -e 's|<title>Counter Check (design preview)</title>|<title>Counter Check</title>|' \
    -e 's|<script src="preview.js"></script>|<script src="live.js"></script>|' preview.html > live.html
cp preview.js live.js
grep -q 'src="live.js"' live.html && echo "live.html and live.js now match the preview"
