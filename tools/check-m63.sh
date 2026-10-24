#!/bin/sh
# Fails if code uses features Chromium M63 (Tizen 5.0) does not support. Comment lines are skipped.
cd "$(dirname "$0")/.."
code() { grep -nvE '^\s*(/\*|\*|//)' "$1"; }
bad=0
code app/main.js | grep -E '\?\.[a-zA-Z_(\[]|\?\?' && { echo "optional chaining / nullish"; bad=1; }
code app/main.js | grep -E '^[0-9]+:\s*(import|export) ' && { echo "ES modules"; bad=1; }
code app/style.css | grep -E '(^|[^-a-z])gap\s*:|conic-gradient|backdrop-filter|blur\(' && { echo "unsupported CSS"; bad=1; }
code service.js | grep -E 'Buffer\.alloc|=>|\bconst\b|\blet\b|`' && { echo "service.js must stay ES5"; bad=1; }
[ $bad = 0 ] && echo "M63 check: OK"
exit $bad
