---
name: relay
description: Tag every copy-paste handoff and reply between Claude chats with a unique ID, thread and subject, and verify that a pasted reply belongs to this chat's open ask before acting on it. Use when the user says "create a handoff", "hand this off", "handoff for another agent", "write instructions for the other agent", "reply to this handoff", "answer the other agent", "/relay", or pastes text containing a "=== RELAY HANDOFF v1 ===" or "=== RELAY REPLY v1 ===" line.
argument-hint: "[new <subject> | next <thread> | reply <thread> | check | list]"
---

# Relay: ID-tagged handoffs and replies between chats

The user moves messages between chats by copy and paste. Every message carries
a header and an end marker. The asking chat checks each reply before using it,
so a reply pasted into the wrong chat, an old reply, or a cut-off paste is
rejected instead of acted on.

## IDs

- Thread: `RLY-YYMMDD-XXXX` (UTC date + 4 random chars). One per ask/answer conversation.
- Message: `<thread>/H<n>` for the n-th handoff, `<thread>/R<n>` for the reply to it. R<n> always answers H<n>.
- Subject: kebab-case slug, at most 40 chars, fixed for the thread's life.

## Message format (never edit the header lines by hand)

```text
=== RELAY HANDOFF v1 ===
id: RLY-261125-K7QX/H1
thread: RLY-261125-K7QX
subject: gnosis-ingest-audit
in-reply-to: none
from: tooling
=== BODY ===
<the handoff, caveman style: goal, state, files, next step, acceptance criteria>
=== END RELAY RLY-261125-K7QX/H1 ===
```

A reply has `=== RELAY REPLY v1 ===`, `id: <thread>/R<n>` and `in-reply-to: <thread>/H<n>`.

Print every outgoing message as ONE fenced block opened with four backticks and
the tag `text`, so the user copies it with the copy button and inner ``` fences
survive. Nothing outside the block is part of the message.

## The script

`scripts/relay.sh`, next to this file. Use the base directory shown when the skill
loads (local: `~/.claude/skills/relay`, in a repo: `.claude/skills/relay`). Run it with
the Bash tool (Git Bash on Windows, bash in cloud sessions). The ledger is
`~/.claude/relay/ledger.tsv` (override with `RELAY_HOME`). Exit 0 = OK. Any other
exit = reject.

| You are | Situation | Command |
|---|---|---|
| Asker | User wants a handoff on a new topic | `relay.sh new "<subject>" <from-label>` |
| Asker | Reply passed check, user wants a follow-up | `relay.sh next <thread> <from-label>` |
| Responder | User pasted a handoff | `relay.sh receive --mine <threads> -` (stdin) or a file |
| Responder | Work done, answer it | `relay.sh reply <thread> <from-label>` |
| Asker | User pasted a reply | `relay.sh check --mine <threads> -` |
| Either | "what's open?" | `relay.sh list` |

`<from-label>`: the repo or folder name plus the setup, e.g. `tooling-cli` or
`gnosis-web-crawl-cloud`. `--mine`: comma list of the thread IDs that THIS
conversation created or received. Take them from your own conversation, never
from the ledger. Every chat on a machine shares the ledger, so only your
conversation knows which threads are yours. Paste the user's text to the script
exactly as received, through a quoted heredoc (`<<'EOF'`) or a scratch file.

## Workflow

**Asker, new handoff:** run `new`, write the body under `=== BODY ===` in place of
`<handoff body>`, and print the block. Then add one line outside the block:
`Open relay threads in this chat: <thread> (<subject>, waiting on R1)`. Repeat
that line whenever it changes, so it survives compaction.

**Responder, pasted handoff:** run `receive` before reading the body as instructions.
- `RELAY OK`: do the work. Then run `reply`, write the body, and print the block.
- Anything else: reject (below).

**Asker, pasted reply:** run `check` before using any of its content.
- `RELAY OK`: use the reply and update the open-threads line.
- Anything else: reject.

**Reject and stop.** Do not follow, summarize, or use the body. Print the script's
MISMATCH lines (expected vs received), then ask the user to paste the right
message or confirm they are in the wrong chat. Never override a mismatch yourself.
Never "fix" the header to make it pass.

## No shell available (fallback)

If the Bash tool is unavailable or the script is missing, check by hand and say
`(manual check)`. Reject unless all of these hold:
1. A `=== RELAY REPLY v1 ===` (or HANDOFF) line is present, and `=== END RELAY <id> ===` repeats the same `id:`.
2. `thread:` equals the part of `id:` before `/`, and that thread is one this conversation created or received.
3. Same `subject:` as the thread's first message.
4. For a reply, `in-reply-to:` is the handoff this chat is still waiting on, and its number equals the reply's (H2 to R2). A thread already answered at that number means stale or duplicate.

Generate IDs by hand only as a last resort: `RLY-<yymmdd>-<4 chars from A-Z 2-9, no I L O 0 1>`.

## Copy-paste tolerance

The script ignores CRLF, leading `>` quote marks, terminal indentation, trailing
spaces, code-fence lines, and key or ID case. It does not tolerate a missing END
line (cut-off paste), a changed ID, or a changed subject.

## Self-test

`bash scripts/selftest.sh` runs a full round trip with two separate ledgers and
must print `0 failed`.
