#!/usr/bin/env node
// Local test runner for post-comment.js — mocks GitHub API and prints comment to stdout.
"use strict";

process.env.DRY_RUN = "1";

const postComment = require("./post-comment.js");

const mockCore = {
    setOutput: (name, value) => {},
    info: (msg) => console.error("[core.info]", msg),
};

const mockContext = {
    eventName: "pull_request",
    repo: { owner: "test", repo: "python-doctor" },
    issue: { number: 1 },
};

const mockGithub = {
    rest: {
        issues: {
            listComments: async () => ({ data: [] }),
            deleteComment: async () => {},
            createComment: async () => {},
        },
    },
};

postComment({ github: mockGithub, context: mockContext, core: mockCore }).catch((err) => {
    console.error("post-comment failed:", err);
    process.exit(1);
});
