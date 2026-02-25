#!/usr/bin/env bash
# get-changed-files.sh
# Resolves changed .py, .sql, and .md files within APP_PATH across several git diff
# strategies, writing output files used by subsequent analysis steps:
#
#   /tmp/pydoctor_changed_py.txt   — repo-root-relative .py paths  (may be empty)
#   /tmp/pydoctor_relative_py.txt  — app-relative .py paths        (for cd + xargs)
#   /tmp/pydoctor_changed_sql.txt  — repo-root-relative .sql paths (may be empty)
#   /tmp/pydoctor_relative_sql.txt — app-relative .sql paths       (for cd + xargs)
#   /tmp/pydoctor_changed_md.txt   — repo-root-relative .md paths  (may be empty)
#   /tmp/pydoctor_relative_md.txt  — app-relative .md paths       (for cd + xargs)
#
# Required env vars: BASE_REF, HEAD_SHA, APP_PATH

set -euo pipefail

: "${BASE_REF:?BASE_REF must be set}"
: "${HEAD_SHA:?HEAD_SHA must be set}"
: "${APP_PATH:?APP_PATH must be set}"

# Normalise APP_PATH — strip trailing slash
APP_PATH="${APP_PATH%/}"

# Escape APP_PATH for use in grep regex
ESCAPED_PATH=$(printf '%s' "$APP_PATH" | sed 's/[.[\*^$]/\\&/g')

# ── Helper: try a diff strategy, write matches to a temp file ──────────────
try_diff() {
    local from="$1" to="$2" outfile="$3" ext="$4"
    git diff --name-only --diff-filter=ACMR "${from}...${to}" 2>/dev/null \
        | grep -E "^${ESCAPED_PATH}/.*\\.${ext}$" \
        >> "$outfile" || true
}

# ── Initialise output files ────────────────────────────────────────────────
for f in /tmp/pydoctor_changed_py.txt \
            /tmp/pydoctor_relative_py.txt \
            /tmp/pydoctor_changed_sql.txt \
            /tmp/pydoctor_relative_sql.txt \
            /tmp/pydoctor_changed_md.txt \
            /tmp/pydoctor_relative_md.txt; do
    : > "$f"
done

# ── Resolve changed files for each extension ──────────────────────────────
for EXT in py sql md; do
    RAW_FILE="/tmp/pydoctor_raw_${EXT}.txt"
    : > "$RAW_FILE"

    # Strategy 1: origin/<base>...<head>
    try_diff "origin/${BASE_REF}" "${HEAD_SHA}" "$RAW_FILE" "$EXT"

    # Strategy 2: <base>...<head> (no origin/ prefix — sometimes needed in forks)
    if [ ! -s "$RAW_FILE" ]; then
        try_diff "${BASE_REF}" "${HEAD_SHA}" "$RAW_FILE" "$EXT"
    fi

    # Strategy 3: merge-base explicit
    if [ ! -s "$RAW_FILE" ]; then
        BASE_SHA=$(git merge-base "origin/${BASE_REF}" "${HEAD_SHA}" 2>/dev/null || echo "")
        if [ -n "${BASE_SHA}" ]; then
        try_diff "${BASE_SHA}" "${HEAD_SHA}" "$RAW_FILE" "$EXT"
        fi
    fi

    # Deduplicate + sort
    sort -u "$RAW_FILE" -o "$RAW_FILE"

    if [ -s "$RAW_FILE" ]; then
        # Absolute paths (repo-root-relative)
        cp "$RAW_FILE" "/tmp/pydoctor_changed_${EXT}.txt"

        # Strip the app prefix so tools can be run with `cd $APP_PATH`
        sed "s|^${ESCAPED_PATH}/||" "$RAW_FILE" \
        > "/tmp/pydoctor_relative_${EXT}.txt"

        COUNT=$(wc -l < "$RAW_FILE" | tr -d ' ')
        echo "ℹ️  Python Doctor: found ${COUNT} changed .${EXT} file(s) in ${APP_PATH}"
    else
        echo "ℹ️  Python Doctor: no changed .${EXT} files found in ${APP_PATH}"
    fi
done
