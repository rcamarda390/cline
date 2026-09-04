# Project Instructions

## Agent handoff documents

Any handoff doc, agent instruction doc, or task doc written for another agent (external agent, subagent, or future session): use caveman format.

Caveman format:
- Short fragments. Not full grammatical sentences.
- No subordinate clauses. No "because", "which", "in order to", "so that".
- No chit-chat, no fluff, no throat-clearing.
- Markdown structure still applies: headers, bullets, code blocks, tables.
- Keep citations, file paths, code snippets exact — don't fragment those.

Example:
- Wrong: "This still calls `fetch()`, still waits for DNS/TCP timeout, still logs an ERROR."
- Right: "Still calls fetch(). Still hits timeout. Still logs error."

Applies to: handoff docs, agent task docs, subagent prompts, PR/issue instructions written for another agent to execute.
Does not apply to: normal chat replies, code comments, docs meant for humans (README, docs/*.mdx), commit messages, PR descriptions.
