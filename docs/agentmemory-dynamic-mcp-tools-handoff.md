# HANDOFF: Dynamic MCP tools in skills → store in agentmemory-mcp

Audience: internal agent. Goal: save knowledge below into `agentmemory` MCP, then PROVE saved.
Source: commit `10525ff` (+ `5e5527a` proto fix). Code: `apps/vscode/src/shared/mcpToolPolicy.ts`.

---

## 1. FACTS TO STORE (memory payloads)

Store each as ONE separate note. Keep text verbatim. Tag all: `cline`, `skills`, `mcp`, `dynamic-tools`.

### Note A — what feature is
```
Dynamic MCP tool availability (Cline). Big MCP servers (100+ tools) no longer must be in every request schema.
Skill declares which MCP tools it needs. Tool hidden until that skill activated.
Visibility filter ONLY. NOT auth. MCP server `disabled`, tool `autoApprove`, approval flow = real gatekeepers.
Default = "Always On" = old behavior. Opt-in. Revert commit 10525ff removes feature.
```

### Note B — SKILL.md frontmatter
```
SKILL.md frontmatter fields (YAML), flat strings "server:tool":
  allowed_mcp_tools:    [ "agentmemory:search_notes", "atlassian:jira_*" ]
  disallowed_mcp_tools: [ "atlassian:jira_delete_*" ]
Rules:
- Split on FIRST colon only. server = before, tool pattern = after.
- "*" wildcard, any count. "prefix_*", "*_suffix", "*". No other glob.
- Single string OK (auto-wrapped to list).
- DENY WINS on overlap, every mode.
- Malformed entry (no colon, empty side, non-string) -> dropped + warn log. Skill still loads (fail-soft).
- Field absent != field empty list. Absent = "undeclared". `[]` = "declared, nothing".
Parser: apps/vscode/src/core/context/instructions/user-instructions/skills.ts parseSkillMcpToolDeclarations
```

### Note C — setting + 4 modes
```
Setting: Settings > Features > "Optional MCP Tools". Key: mcpToolAvailability.
Plan/Act split keys: planModeMcpToolAvailability / actModeMcpToolAvailability (used only when planActSeparateModelsSetting=true; else shared value, split values ignored).
Values:
- always_on (default): all tools shown.
- always_off: only BASELINE tools shown.
- dynamic_compatible: active skill has NO declarations -> all tools (legacy fallback, warn log). Else baseline + skill allowed.
- dynamic_declared_only: baseline + active skill allowed. No fallback.
BASELINE tool = no enabled skill (any) mentions it in allow/deny. Per-TOOL not per-server.
 -> one skill naming agentmemory:search_notes does NOT hide other agentmemory tools.
```

### Note D — lifecycle
```
Active skill policy frozen on TaskState at activation (UseSkillToolHandler.snapshotActiveSkillMcpPolicy) -> stable cache prefix.
Persisted in task metadata key active_skill_mcp_policy. Revalidated on task resume.
Enforced at: native tool schema gen, legacy/XML MCP prompt section, UseMcpToolHandler (single exec point).
Only server .tools filtered. Resources/templates/prompts stay visible.
```

### Note E — skill locations
```
Skills scanned (apps/vscode/src/core/storage/disk.ts getSkillsDirectoriesForScan):
project: <cwd>/.clinerules/skills, <cwd>/.cline/skills, <cwd>/.claude/skills, <cwd>/.agents/skills
global:  ~/.cline/skills, ~/.agents/skills
Layout: <dir>/<skill-name>/SKILL.md. Needs frontmatter name + description or skill skipped.
```

### Note F — gotchas
```
- New global setting needs proto: UpdateSettingsRequest in proto/cline/state.proto is hand-maintained (not derived from state-keys.ts). Run `npm run protos`.
- Dynamic mode with skill lacking declarations = silent broad fallback only in dynamic_compatible.
- Test: apps/vscode/src/shared/__tests__/mcpToolPolicy.test.ts
```

---

## 2. EXAMPLE SKILL (for note G, optional)

Path: `.cline/skills/memory-search/SKILL.md`
```markdown
---
name: memory-search
description: Search and write long-term notes in agentmemory. Use when user asks to recall or save project knowledge.
allowed_mcp_tools:
  - agentmemory:search_notes
  - agentmemory:add_note
disallowed_mcp_tools:
  - agentmemory:delete_*
---

# Memory search
Use `agentmemory` tools to recall and save notes.
```
Use real tool names from step 3 — `search_notes` is only name confirmed in code comments. Others = placeholders.

---

## 3. PROCEDURE

1. **Discover tools.** List agentmemory server's tools (MCP tool list / `ListMcpResourcesTool`). Write down exact names for: add/create, search/query, get/list, delete. Do NOT guess names.
2. **Add notes.** For A–F: call the add/create tool. One call per note. Include tags. Record returned ID of each.
3. **Verify each.** Per note:
   - call search tool with a unique phrase from the note (e.g. `deny wins on overlap`, `first colon only`, `Optional MCP Tools`, `active_skill_mcp_policy`, `getSkillsDirectoriesForScan`, `hand-maintained`).
   - OR call get-by-ID tool with the ID from step 2.
   - PASS = returned text contains the phrase. FAIL = empty / wrong note.
4. **Retry** failed notes once. Still failing -> report error text verbatim, stop.
5. **Dedupe check.** Search `Dynamic MCP tool availability`. Exactly 1 hit for note A. If >1, delete extras (keep newest).
6. **Report** table:

| Note | ID | Phrase searched | PASS/FAIL |
|---|---|---|---|

---

## 4. DONE CRITERIA

- [ ] 6 notes (A–F) stored
- [ ] each retrievable by search AND/OR ID
- [ ] no duplicates
- [ ] table reported
- [ ] no secrets/tokens written to memory

## 5. DON'T

- Don't paraphrase payloads.
- Don't invent tool names.
- Don't edit repo code.
- Don't claim success without step 3 result.
