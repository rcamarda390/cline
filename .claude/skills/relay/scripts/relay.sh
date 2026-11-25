#!/usr/bin/env bash
# relay.sh — IDs, headers and checks for copy-paste agent handoffs.
# Works in Git Bash (Windows CLI/desktop app) and Linux (cloud sessions).
# Ledger: one TSV per machine/container, $RELAY_HOME (default ~/.claude/relay).
#   columns: thread  subject  role(asker|responder)  last(H1/R1..)  status  updated
set -euo pipefail

LEDGER_DIR="${RELAY_HOME:-$HOME/.claude/relay}"
LEDGER="$LEDGER_DIR/ledger.tsv"
mkdir -p "$LEDGER_DIR"; touch "$LEDGER"

die() { echo "RELAY ERROR: $*" >&2; exit 2; }
now() { date -u +%Y-%m-%dT%H:%MZ; }
slug() { printf '%s' "$*" | tr 'A-Z' 'a-z' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-40; }
# Crockford-ish alphabet: no 0/O/1/I/L confusion when read back off a screen.
# Bounded read: `tr </dev/urandom | head` dies of SIGPIPE under pipefail.
rand4() { local s=""; while [ ${#s} -lt 4 ]; do s+=$(head -c 32 /dev/urandom | LC_ALL=C tr -dc 'ABCDEFGHJKMNPQRSTVWXYZ23456789'); done; printf '%s' "${s:0:4}"; }

row()     { awk -F'\t' -v t="$1" -v r="$2" '$1==t && $3==r' "$LEDGER" | tail -1; }
set_row() { # thread subject role last status — replace any row for thread+role
  local tmp; tmp=$(mktemp "$LEDGER.XXXXXX") # unique per chat; shortcut: no lock, two chats writing the same instant can drop one row
  awk -F'\t' -v t="$1" -v r="$3" '!($1==t && $3==r)' "$LEDGER" > "$tmp"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" "$5" "$(now)" >> "$tmp"
  mv "$tmp" "$LEDGER"
}

header() { # kind thread subject seq in-reply-to from
  printf '=== RELAY %s v1 ===\nid: %s/%s\nthread: %s\nsubject: %s\nin-reply-to: %s\nfrom: %s\n=== BODY ===\n' \
    "$1" "$2" "$4" "$2" "$3" "$5" "$6"
}
footer() { printf '=== END RELAY %s/%s ===\n' "$1" "$2"; }

# Normalise a pasted message: CRLF, markdown quote marks, terminal indent,
# code-fence lines, key case. Copy/paste damage must not cause a false reject.
parse() { # file -> sets P_KIND P_ID P_THREAD P_SUBJECT P_IRT P_END
  local f="$1" norm
  norm=$(tr -d '\r' < "$f" | sed -E 's/^[[:space:]>]*//; s/[[:space:]]+$//' | grep -vE '^(`{3,}|~{3,})' || true)
  case "$f" in "$LEDGER_DIR"/in.*) rm -f "$f" ;; esac # stdin scratch copy
  P_KIND=$(printf '%s\n' "$norm" | sed -nE 's/^=== RELAY (HANDOFF|REPLY) v1 ===$/\1/Ip' | head -1 | tr a-z A-Z)
  kv() { printf '%s\n' "$norm" | sed -nE "s/^$1:[[:space:]]*//Ip" | head -1; }
  P_ID=$(kv id | tr a-z A-Z); P_THREAD=$(kv thread | tr a-z A-Z)
  P_SUBJECT=$(slug "$(kv subject)"); P_IRT=$(kv in-reply-to | tr a-z A-Z)
  P_END=$(printf '%s\n' "$norm" | sed -nE 's/^=== END RELAY (.+) ===$/\1/Ip' | tail -1 | tr a-z A-Z)
  [ -n "$P_KIND" ] || die "no '=== RELAY HANDOFF|REPLY v1 ===' line found — not a relay message"
}
seqnum() { printf '%s' "${1##*/}" | sed -E 's/^[HR]//'; }

FAIL=()
expect() { # label expected got
  [ "$2" = "$3" ] || FAIL+=("$1: expected '$2', received '${3:-<missing>}'")
}
verdict() { # ok-message
  if [ ${#FAIL[@]} -eq 0 ]; then echo "RELAY OK — $1"; exit 0; fi
  echo "RELAY MISMATCH — do NOT act on this message. Ask the user to paste the right one."
  printf '  - %s\n' "${FAIL[@]}"; exit 1
}
input() { local f; [ "${1:--}" = - ] || { echo "$1"; return; }; f=$(mktemp "$LEDGER_DIR/in.XXXXXX"); cat > "$f"; echo "$f"; }

cmd="${1:-}"; shift || true
# --mine T1,T2: threads THIS chat owns, from the agent's own conversation.
# The ledger is shared by every chat on the machine, so it alone cannot tell
# "a reply for some chat here" from "a reply for this chat".
MINE=""; [ "${1:-}" = --mine ] && { MINE=",$(printf '%s' "${2:-}" | tr a-z A-Z | tr -d ' '),"; shift 2; }
mine() { [ -n "$MINE" ] && [[ "$MINE" == *",$1,"* ]]; }
case "$cmd" in
  new) # asker: new thread.  relay.sh new "<subject>" [from-label]
    [ -n "${1:-}" ] || die "usage: relay.sh new \"<subject>\" [from-label]"
    s=$(slug "$1"); from="${2:-$(basename "$PWD")}"
    for _ in 1 2 3 4 5; do t="RLY-$(date -u +%y%m%d)-$(rand4)"; [ -z "$(cut -f1 "$LEDGER" | grep -Fx "$t")" ] && break; done
    set_row "$t" "$s" asker H1 awaiting
    header HANDOFF "$t" "$s" H1 none "$from"; echo "<handoff body>"; footer "$t" H1 ;;

  next) # asker: follow-up on a thread after its reply passed check.  relay.sh next <thread> [from]
    t=$(printf '%s' "${1:-}" | tr a-z A-Z); r=$(row "$t" asker)
    [ -n "$r" ] || die "thread $t is not one this machine started (ledger $LEDGER)"
    IFS=$'\t' read -r _ s _ last st _ <<<"$r"
    [ "$st" = answered ] || die "thread $t is '$st' (last $last); wait for and check the reply first"
    n=$(( $(seqnum "$last") + 1 )); from="${2:-$(basename "$PWD")}"
    set_row "$t" "$s" asker "H$n" awaiting
    header HANDOFF "$t" "$s" "H$n" "$t/$last" "$from"; echo "<handoff body>"; footer "$t" "H$n" ;;

  receive) # responder: validate a pasted handoff.  relay.sh receive <file|->
    f=$(input "${1:--}"); parse "$f"
    expect "message type" HANDOFF "$P_KIND"
    expect "thread vs id" "$P_THREAD" "${P_ID%/*}"
    expect "end marker (truncated paste?)" "$P_ID" "$P_END"
    n=$(seqnum "$P_ID"); r=$(row "$P_THREAD" responder)
    if [ -n "$r" ]; then
      IFS=$'\t' read -r _ s _ last st _ <<<"$r"
      expect "subject" "$s" "$P_SUBJECT"
      # after our reply the next handoff is H(n+1); before it, only a re-paste of Hn fits
      want=$(seqnum "$last"); [ "$st" = replied ] && want=$((want + 1))
      expect "handoff number (this chat last saw $last)" "H$want" "H$n"
    elif [ "$n" != 1 ]; then
      FAIL+=("thread: this machine never received $P_THREAD/H1, so H$n does not belong here")
    fi
    [ "$n" = 1 ] || mine "$P_THREAD" || FAIL+=("thread: $P_THREAD is not in this chat's threads (--mine '${MINE//,/ }') — wrong chat?")
    [ ${#FAIL[@]} -eq 0 ] && set_row "$P_THREAD" "$P_SUBJECT" responder "H$n" open
    verdict "handoff $P_ID ($P_SUBJECT) accepted. When done, run: relay.sh reply $P_THREAD" ;;

  reply) # responder: header for the answer to the open handoff.  relay.sh reply <thread> [from]
    t=$(printf '%s' "${1:-}" | tr a-z A-Z); r=$(row "$t" responder)
    [ -n "$r" ] || die "no handoff for $t received in this ledger; run receive first"
    IFS=$'\t' read -r _ s _ last st _ <<<"$r"
    [ "$st" = open ] || die "handoff $t/$last already replied; a new handoff must arrive first"
    n=$(seqnum "$last"); from="${2:-$(basename "$PWD")}"
    set_row "$t" "$s" responder "R$n" replied
    header REPLY "$t" "$s" "R$n" "$t/H$n" "$from"; echo "<reply body>"; footer "$t" "R$n" ;;

  check) # asker: validate a pasted reply.  relay.sh check <file|->
    [ -n "$MINE" ] || die "usage: relay.sh check --mine <this chat's thread ids> <file|->"
    f=$(input "${1:--}"); parse "$f"
    expect "message type" REPLY "$P_KIND"
    mine "$P_THREAD" || FAIL+=("thread: $P_THREAD is not one this chat is waiting on (${MINE//,/ }) — wrong chat?")
    expect "thread vs id" "$P_THREAD" "${P_ID%/*}"
    expect "end marker (truncated paste?)" "$P_ID" "$P_END"
    r=$(row "$P_THREAD" asker)
    if [ -z "$r" ]; then
      FAIL+=("thread: $P_THREAD was not started from this machine/chat — wrong chat?")
    else
      IFS=$'\t' read -r _ s _ last st _ <<<"$r"
      expect "subject" "$s" "$P_SUBJECT"
      expect "in-reply-to (the ask still waiting)" "$P_THREAD/$last" "$P_IRT"
      expect "reply number" "$P_THREAD/R$(seqnum "$last")" "$P_ID"
      [ "$st" = awaiting ] || FAIL+=("status: $P_THREAD/$last is '$st' — this reply is stale or a duplicate")
    fi
    [ ${#FAIL[@]} -eq 0 ] && set_row "$P_THREAD" "$s" asker "$last" answered
    verdict "reply $P_ID matches ask $P_IRT ($P_SUBJECT)" ;;

  list) column -t -s $'\t' "$LEDGER" 2>/dev/null || cat "$LEDGER" ;;
  *) die "usage: relay.sh new <subject> [from] | next <thread> [from] | receive [--mine T,..] <file|-> | reply <thread> [from] | check --mine T,.. <file|-> | list" ;;
esac
