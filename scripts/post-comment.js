// post-comment.js
// Reads tool output files, computes a health score, and posts (or updates)
// a single collapsible PR comment. Exported as a function so action.yml
// can call it via `require(...)`.
"use strict";

const fs = require("fs");

// ── Tool definitions ────────────────────────────────────────────────────────
// weight: how many points are deducted from 100 if this tool has findings.
// Weights sum to 100 so a clean run always scores exactly 100.
// Weights are set per preset (see SCORE_PRESETS below).
const TOOLS = [
    { id: "ruff", label: "🔍 Ruff", desc: "lint + style", file: "/tmp/pydoctor_ruff.txt" },
    { id: "mypy", label: "🔷 mypy", desc: "type check", file: "/tmp/pydoctor_mypy.txt" },
    { id: "bandit", label: "🔒 Bandit", desc: "security", file: "/tmp/pydoctor_bandit.txt" },
    { id: "vulture", label: "🪦 Vulture", desc: "dead code", file: "/tmp/pydoctor_vulture.txt" },
    { id: "radon", label: "📐 Radon", desc: "complexity", file: "/tmp/pydoctor_radon.txt" },
    { id: "sqlfluff", label: "🗄️ SQLFluff", desc: "SQL", file: "/tmp/pydoctor_sqlfluff.txt" },
    { id: "markdownlint", label: "📝 markdownlint", desc: "Markdown", file: "/tmp/pydoctor_markdownlint.txt" },
];

// Score presets: weights per tool (must sum to 100).
// - balanced: equal weight (16/17 pts each), extra to structure (Vulture, Radon, Bandit)
// - structure: heavy on Vulture, Radon, Bandit; minimal on Ruff, SQLFluff, MarkdownLint
// - quality: heavy on Ruff, SQLFluff, MarkdownLint; minimal on Vulture, Radon, Bandit
const SCORE_PRESETS = {
    balanced: {
        ruff: 14, mypy: 14, bandit: 15, vulture: 15, radon: 15, sqlfluff: 14, markdownlint: 13,
    },
    structure: {
        ruff: 2, mypy: 2, bandit: 30, vulture: 30, radon: 30, sqlfluff: 3, markdownlint: 3,
    },
    quality: {
        ruff: 23, mypy: 23, bandit: 3, vulture: 3, radon: 3, sqlfluff: 23, markdownlint: 22,
    },
};

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

// Base URL for nurse reaction images (raw GitHub content)
const DEFAULT_IMAGES_BASE = "https://raw.githubusercontent.com/seanfroning/python-nurse/main/assets/nurses";

/** Map a score to a label + nurse image. */
function scoreLabel(score, imagesBase) {
    const base = imagesBase || DEFAULT_IMAGES_BASE;
    if (score >= 90) return { label: "Great", image: `![Great](${base}/great.jpeg)` };
    if (score >= 75) return { label: "Good", image: `![Good](${base}/good.jpeg)` };
    if (score >= 50) return { label: "Needs work", image: `![Needs work](${base}/needs-work.jpeg)` };
    return { label: "Critical", image: `![Critical](${base}/critical.jpeg)` };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Called by action.yml via `actions/github-script`.
 * @param {{ github, context, core }} kit
 */
module.exports = async function postComment({ github, context, core }) {
    const shouldPost = (process.env.POST_COMMENT ?? "true") === "true";
    const isPR = context.eventName === "pull_request";

    // ── Resolve preset and apply weights ───────────────────────────────────
    const preset = (process.env.SCORE_PRESET ?? "balanced").toLowerCase();
    const presetWeights = SCORE_PRESETS[preset] ?? SCORE_PRESETS.balanced;
    const toolsWithWeights = TOOLS.map((t) => ({ ...t, weight: presetWeights[t.id] ?? 14 }));

    // ── Evaluate each tool ─────────────────────────────────────────────────
    const results = toolsWithWeights.map((tool) => ({
        tool,
        ...readTool(tool),
    }));

    const findings = results.filter((r) => r.hasFindings);
    const clean = results.filter((r) => !r.hasFindings);

    // ── Score ──────────────────────────────────────────────────────────────
    const deducted = findings.reduce((sum, r) => sum + r.tool.weight, 0);
    const score = Math.max(0, 100 - deducted);
    const { label, image } = scoreLabel(score, process.env.IMAGES_BASE_URL);

    // Expose outputs for downstream steps
    core.setOutput("score", String(score));
    core.setOutput("has_findings", String(findings.length > 0));
    core.info(`🐍 Python Doctor  — score: ${score}/100 (${label})`);

    const isDryRun = process.env.DRY_RUN === "1";

    // ── Build comment body ─────────────────────────────────────────────────
    if (!isDryRun && (!shouldPost || !isPR || findings.length === 0)) {
        if (findings.length === 0) {
            core.info("✅ Python Doctor: no issues found — skipping comment.");
        }

        // Still delete a stale comment from a previous run if the code is now clean
        if (isPR && shouldPost) {
            await deleteExistingComment({ github, context });
        }
        if (!isDryRun) return;
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

    const sections = findings.length > 0 ? findings.map((r) => renderSection(r.tool, r.content)) : [];

    let body = [
        MARKER,
        `## 🐍 Python Nurse`,
        ``,
        `**Health Score: ${score}/100** — ${label}`,
        ``,
        image,
        `\`${bar}\``,
        passedLine,
        findings.length > 0 ? `---\n\n${sections.join("\n\n")}` : "",
    ].filter(Boolean).join("\n");

    // Hard truncation safety net
    if (body.length > MAX_COMMENT) {
        const notice =
            "\n\n⚠️ _Comment truncated — total output exceeded GitHub's 65 536-char limit._";
        body = body.slice(0, MAX_COMMENT - notice.length) + notice;
    }

    // ── Upsert comment (or dry-run print) ──────────────────────────────────
    if (isDryRun) {
        console.log("\n" + "─".repeat(60) + "\n📋 Python Doctor — dry-run comment output:\n" + "─".repeat(60));
        console.log(body);
        console.log("─".repeat(60) + "\n");
        return;
    }

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