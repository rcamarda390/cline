# Cline 4.0.12 Prompt Patch

This branch is based directly on upstream commit `f267bf47e394e2c38f8b321c973a8d5867a14cd5` (v4.0.12).

Manifest version: `4.0.12-prompt-patch.9`

Includes independent Plan/Act AWS Bedrock prompt-cache settings with legacy
shared-setting fallback, Nemotron native tools, severity-aware output logging,
quiet no-op hooks, offline mode, marketplace policy enforcement, the missing
focus-chain prompt component, and hook completion updates in the webview.

Compatibility test target: VS Code `1.98.2`. Do not use moving `stable` downloads.

Build with the **Build Cline 4.0.12 Prompt Patch** workflow. Its version guard
rejects a different release line. The previous newer main is preserved at
`archive/main-4.1.16-2026-09-05`; new fixes should be backported to this line.

The numeric core uses three SemVer components because VSIX rejects four-component extension versions.
