#!/usr/bin/env bash
# test-action.sh — Run the Python Nurse sequence locally and "post" a dry-run comment.
# Strict: exits 1 on any error. Use as pre-push check via `pnpm local-test`.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_PATH="$REPO_ROOT/test-fixture"

cd "$REPO_ROOT"

# ── Sanity checks ─────────────────────────────────────────────────────────
if [ ! -f "action.yml" ]; then
    echo "❌ Must run from repo root (action.yml not found)" >&2
    exit 1
fi

if ! command -v python3 &>/dev/null; then
    echo "❌ python3 required" >&2
    exit 1
fi

if ! command -v node &>/dev/null; then
    echo "❌ node required" >&2
    exit 1
fi

# ── Populate changed files (deterministic for test-fixture) ─────────────────
echo "📂 Populating changed files for test-fixture..."
for f in /tmp/pydoctor_changed_py.txt /tmp/pydoctor_relative_py.txt \
         /tmp/pydoctor_changed_sql.txt /tmp/pydoctor_relative_sql.txt \
         /tmp/pydoctor_changed_md.txt /tmp/pydoctor_relative_md.txt; do
    : > "$f"
done

# Include all .py, .sql, .md in test-fixture
for ext in py sql md; do
    while IFS= read -r -d '' f; do
        rel="${f#$APP_PATH/}"
        echo "$f" >> "/tmp/pydoctor_changed_${ext}.txt"
        echo "$rel" >> "/tmp/pydoctor_relative_${ext}.txt"
    done < <(find "$APP_PATH" -name "*.${ext}" -print0 2>/dev/null || true)
done

# Ensure at least one file for tools that need input
if [ ! -s /tmp/pydoctor_changed_py.txt ]; then
    echo "❌ test-fixture has no .py files" >&2
    exit 1
fi

# ── Install Python tools (strict) ──────────────────────────────────────────
echo "📦 Installing analysis tools..."
pip install --quiet ruff mypy bandit[toml] vulture radon sqlfluff || {
    echo "❌ pip install failed" >&2
    exit 1
}

# ── Run analysis tools ─────────────────────────────────────────────────────
echo "🔍 Running Ruff..."
cd "$APP_PATH"
xargs ruff check --output-format=full 2>&1 < /tmp/pydoctor_relative_py.txt | tee /tmp/pydoctor_ruff.txt || true

echo "🔷 Running mypy..."
xargs mypy --ignore-missing-imports 2>&1 < /tmp/pydoctor_relative_py.txt | tee /tmp/pydoctor_mypy.txt || true

echo "🔒 Running Bandit..."
xargs bandit -ll 2>&1 < /tmp/pydoctor_relative_py.txt | tee /tmp/pydoctor_bandit.txt || true

echo "🪦 Running Vulture..."
xargs vulture --min-confidence 80 2>&1 < /tmp/pydoctor_relative_py.txt | tee /tmp/pydoctor_vulture.txt || true

echo "📐 Running Radon..."
{
    xargs radon cc -s -n D 2>&1 < /tmp/pydoctor_relative_py.txt || true
    xargs radon mi -s -n B 2>&1 < /tmp/pydoctor_relative_py.txt || true
} | tee /tmp/pydoctor_radon.txt

echo "🗄️ Running SQLFluff..."
if [ -s /tmp/pydoctor_changed_sql.txt ]; then
    xargs sqlfluff lint --dialect postgres 2>&1 < /tmp/pydoctor_relative_sql.txt | tee /tmp/pydoctor_sqlfluff.txt || true
else
    echo "" > /tmp/pydoctor_sqlfluff.txt
fi

echo "📝 Running markdownlint..."
if [ -s /tmp/pydoctor_changed_md.txt ]; then
    xargs npx -y markdownlint-cli@latest 2>&1 < /tmp/pydoctor_relative_md.txt | tee /tmp/pydoctor_markdownlint.txt || true
else
    echo "" > /tmp/pydoctor_markdownlint.txt
fi

cd "$REPO_ROOT"

# ── Run post-comment (dry-run) ─────────────────────────────────────────────
echo ""
node "$SCRIPT_DIR/test-post-comment.js" || {
    echo "❌ post-comment dry-run failed" >&2
    exit 1
}

echo ""
echo "✅ Python Nurse local test passed"
