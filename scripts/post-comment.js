// post-comment.js
// Reads tool output files, computes a health score, and posts (or updates)
// a single collapsible PR comment. Exported as a function so action.yml
// can call it via `require(...)`.
"use strict";

const fs = require("fs");

// ── Tool definitions ────────────────────────────────────────────────────────
// weight: how many points are deducted from 100 if this tool has findings.
// Weights sum to 100 so a clean run always scores exactly 100.
const TOOLS = [
    {
        id: "ruff",
        label: "🔍 Ruff",
        desc: "lint + style",
        file: "/tmp/pydoctor_ruff.txt",
        weight: 20,
        envFlag: "RUFF_ENABLED",        // not used here, tool steps are gated in action.yml
    },
    {
        id: "mypy",
        label: "🔷 mypy",
        desc: "type check",
        file: "/tmp/pydoctor_mypy.txt",
        weight: 20,
    },
    {
        id: "bandit",
        label: "🔒 Bandit",
        desc: "security",
        file: "/tmp/pydoctor_bandit.txt",
        weight: 20,
    },
    {
        id: "vulture",
        label: "🪦 Vulture",
        desc: "dead code",
        file: "/tmp/pydoctor_vulture.txt",
        weight: 15,
    },
    {
        id: "radon",
        label: "📐 Radon",
        desc: "complexity",
        file: "/tmp/pydoctor_radon.txt",
        weight: 15,
    },
    {
        id: "sqlfluff",
        label: "🗄️ SQLFluff",
        desc: "SQL",
        file: "/tmp/pydoctor_sqlfluff.txt",
        weight: 8,
    },
    {
        id: "markdownlint",
        label: "📝 markdownlint",
        desc: "Markdown",
        file: "/tmp/pydoctor_markdownlint.txt",
        weight: 2,
    },
];

// Noise phrases — if a file contains only these, treat it as clean
const NOISE = [
    /^no python files/i,
    /^no sql files/i,
    /^no issues/i,
    /^success/i,
    /^\s*$/,
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Read a tool output file. Returns { content, hasFindings }. */
function readTool(tool) {
    if (!fs.existsSync(tool.file)) {
        return { content: null, hasFindings: false };
    }
    const raw = fs.readFileSync(tool.file, "utf8").trim();
    if (!raw || NOISE.some((re) => re.test(raw))) {
        return { content: null, hasFindings: false };
    }
    return { content: raw, hasFindings: true };
}

/** Render a collapsible section for a tool that has findings. */
function renderSection(tool, content) {
    const header = `${tool.label} (${tool.desc})`;
    // Truncate extremely long outputs per-tool to avoid blowing the whole comment
    const MAX_TOOL_CHARS = 8_000;
    const body =
        content.length > MAX_TOOL_CHARS
            ? content.slice(0, MAX_TOOL_CHARS) +
            `\n\n… _(truncated — ${content.length - MAX_TOOL_CHARS} chars omitted)_`
            : content;

    return [
        `<details>`,
        `<summary><strong>${header}</strong></summary>`,
        ``,
        `\`\`\``,
        body,
        `\`\`\``,
        `</details>`,
    ].join("\n");
}

/** Map a score to a label + emoji. */
function scoreLabel(score) {
    if (score >= 90) return { emoji: "😊", label: "Great" };
    if (score >= 75) return { emoji: "🙂", label: "Good" };
    if (score >= 50) return { emoji: "😐", label: "Needs work" };
    return { emoji: "😞", label: "Critical" };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Called by action.yml via `actions/github-script`.
 * @param {{ github, context, core }} kit
 */
module.exports = async function postComment({ github, context, core }) {
    const shouldPost = (process.env.POST_COMMENT ?? "true") === "true";
    const isPR = context.eventName === "pull_request";

    // ── Evaluate each tool ─────────────────────────────────────────────────
    const results = TOOLS.map((tool) => ({
        tool,
        ...readTool(tool),
    }));

    const findings = results.filter((r) => r.hasFindings);
    const clean = results.filter((r) => !r.hasFindings);

    // ── Score ──────────────────────────────────────────────────────────────
    const deducted = findings.reduce((sum, r) => sum + r.tool.weight, 0);
    const score = Math.max(0, 100 - deducted);
    const { emoji, label } = scoreLabel(score);

    // Expose outputs for downstream steps
    core.setOutput("score", String(score));
    core.setOutput("has_findings", String(findings.length > 0));
    core.info(`🐍 Python Doctor — score: ${score}/100 (${label})`);

    // ── Build comment body ─────────────────────────────────────────────────
    if (!shouldPost || !isPR || findings.length === 0) {
        if (findings.length === 0) {
            core.info("✅ Python Doctor: no issues found — skipping comment.");
        }

        // Still delete a stale comment from a previous run if the code is now clean
        if (isPR && shouldPost) {
            await deleteExistingComment({ github, context });
        }
        return;
    }

    const MARKER = "<!-- python-doctor -->";
    const MAX_COMMENT = 60_000;

    // Score bar (rough visual)
    const filled = Math.round(score / 10);
    const empty = 10 - filled;
    const bar = "█".repeat(filled) + "░".repeat(empty);

    const passedLine =
        clean.length > 0
            ? `\n**Passed:** ${clean.map((r) => `${r.tool.label}`).join(" · ")}\n`
            : "";

    const sections = findings.map((r) => renderSection(r.tool, r.content));

    let body = [
        MARKER,
        `## 🐍 Python Doctor ${emoji}`,
        ``,
        `**Health Score: ${score}/100** — ${label}`,
        `\`${bar}\``,
        passedLine,
        `---`,
        ``,
        sections.join("\n\n"),
    ].join("\n");

    // Hard truncation safety net
    if (body.length > MAX_COMMENT) {
        const notice =
            "\n\n⚠️ _Comment truncated — total output exceeded GitHub's 65 536-char limit._";
        body = body.slice(0, MAX_COMMENT - notice.length) + notice;
    }

    // ── Upsert comment ─────────────────────────────────────────────────────
    const { owner, repo } = context.repo;
    const issue_number = context.issue.number;

    await deleteExistingComment({ github, context });

    await github.rest.issues.createComment({ owner, repo, issue_number, body });
    core.info("💬 Python Doctor: PR comment posted.");
};

// ── Utility ───────────────────────────────────────────────────────────────────

async function deleteExistingComment({ github, context }) {
    const MARKER = "<!-- python-doctor -->";
    const { owner, repo } = context.repo;
    const issue_number = context.issue.number;

    const { data: comments } = await github.rest.issues.listComments({
        owner, repo, issue_number,
    });
    const prev = comments.find((c) => c.body?.startsWith(MARKER));
    if (prev) {
        await github.rest.issues.deleteComment({ owner, repo, comment_id: prev.id });
    }
}