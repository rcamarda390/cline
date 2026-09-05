# Deployment constraint

This fork builds the Cline **4.0.12** patch line for an air-gapped deployment on
**VS Code 1.98.2**. Do not merge newer upstream releases onto `main`, raise the
extension's VS Code engine requirement, or change the compatibility test target
without explicit approval. Backport individual fixes instead.

Use `.github/workflows/build-v4.0.12-prompt-patch.yml` to produce the deployment
VSIX. Keep its patch version, the extension manifest, and package lock in sync.
Run compatibility tests on VS Code 1.98.2, not the moving `stable` release.

The previous 4.1.16 main is preserved at
`archive/main-4.1.16-2026-09-05` (commit
`d6549ca718a0fa8fc2722ee0565669b7ea9128a9`). Retain this archive.

JetBrains sources must remain available; its fork CI is disabled, not deleted.
Also follow `.clinerules/general.md` and `.clinerules/network.md`.
