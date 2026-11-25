#!/usr/bin/env bash
# Round-trip self-test: two isolated ledgers (asker machine, responder machine).
# Pass = good messages accepted, every contaminated one rejected.
set -uo pipefail
R="$(cd "$(dirname "$0")" && pwd)/relay.sh"
T=$(mktemp -d); A="$T/asker"; B="$T/resp"; pass=0; fail=0
as() { RELAY_HOME="$A" bash "$R" "$@"; }
rs() { RELAY_HOME="$B" bash "$R" "$@"; }
ok()  { if "$@" >"$T/out" 2>&1; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL (expected OK): $*"; cat "$T/out"; fi; }
bad() { if "$@" >"$T/out" 2>&1; then fail=$((fail+1)); echo "FAIL (expected reject): $*"; cat "$T/out"; else pass=$((pass+1)); [ -n "${VERBOSE:-}" ] && sed 's/^/    /' "$T/out"; fi; }
tid() { sed -nE 's/^thread: //p' "$1"; }

as new "Gnosis ingest audit" cli >"$T/h1"; t=$(tid "$T/h1")
as new "Other topic" cli >"$T/x1"; x=$(tid "$T/x1")
ok rs receive "$T/h1"
rs reply "$t" cloud >"$T/r1"

# copy-paste damage: CRLF, quote marks, indent, fence, trailing spaces, lower-case keys
{ echo '````'; sed -E 's/^/  > /; s/$/   \r/; s/^(  > )(subject|thread):/\1\U\2:/' "$T/r1"; echo '````'; } >"$T/r1m"
bad as check --mine "$x" "$T/r1m"            # right reply, wrong chat (waits on x only)
ok  as check --mine "$t,$x" "$T/r1m"         # mangled but correct -> accepted
bad as check --mine "$t" "$T/r1"             # same reply pasted again -> stale/duplicate

as next "$t" cli >"$T/h2"
bad as check --mine "$t" "$T/r1"             # old R1 while H2 is waiting -> stale
ok  rs receive "$T/x1"                       # a brand-new H1 is always accepted
ok  rs receive --mine "$t" "$T/h2"
rs reply "$t" cloud >"$T/r2"
sed 's/^subject: .*/subject: other-topic/' "$T/r2" >"$T/r2s"; bad as check --mine "$t" "$T/r2s"   # subject swapped
head -n -1 "$T/r2" >"$T/r2t";                bad as check --mine "$t" "$T/r2t"                       # truncated, no END
sed 's/^=== RELAY REPLY/=== RELAY HANDOFF/' "$T/r2" >"$T/r2k"; bad as check --mine "$t" "$T/r2k"   # a handoff pasted as reply
printf 'just some text\n' >"$T/junk";         bad as check --mine "$t" "$T/junk"                      # no header at all
bad rs receive --mine "$t" "$T/h1"           # responder: old H1 re-pasted after reply
ok  as check --mine "$t" "$T/r2"             # correct R2
rm -rf "$T"; echo "selftest: $pass passed, $fail failed"; [ "$fail" -eq 0 ]
