# Historical subagent liveness fix

The BuildBot3 account-owners workspace (`wks_27a842f7f354d221`) reports running because the native Claude child `toolu_01Vde65KLGA2X9jQk35sodv1` is restored as running from September 27. Its parent `c3256592-0640-4c83-9a6a-0331317815fe` is idle with no active turn or pending permission. The workspace has no terminals.

This is a server-side history restoration defect, not merely a stale desktop display. The loader treats a child without a recorded terminal outcome as running. A fresh provider process does not restore that child's executor.

The patch preserves recorded completed, failed, and canceled outcomes. When no outcome exists, historical replay marks the child canceled (interrupted); a fresh live task event can still move it back to running. It preserves names, IDs, histories, models, permissions, and all active work.

## Verification

- Base: Paseo v0.15.3, commit `d91ae138cb931447635e94296023414a58bedcc5`.
- New regression fails against the original code and passes after the patch.
- All 37 focused replay tests pass.
- Patched server build, server typecheck, and targeted lint pass on BuildBot3.
- Isolated replay of the actual affected child's 255 records returns canceled, retaining its original ID and last timestamp. No model execution or shared runtime mutation occurred.
- Stable v0.15.4 only adds Claude models; it does not include this correction.

## Activation remains pending

No installed code or daemon has been changed. The verified build is retained at `/home/dev/paseo-status-repair-20261110-c3256`.

`apply_verified_patch.py` checks both installed and candidate SHA-256 hashes. Its default action is read-only. After explicit user approval, `--apply` backs up the installed module and atomically installs the verified module; a supported restart of only the BuildBot3 Paseo worker then loads it. The shared CCodex daemon must remain running. Active Paseo turns may be interrupted by that restart.

After activation, verify the same parent/native IDs, provider/model/mode, child status, and live workspace descriptor. The workspace must no longer report running from this historical child. Do not manufacture a successful child outcome or change the parent's review flag to conceal other activity.

Rollback: restore the retained `replay-source.installed-before-fix.js` to the installed module path and restart only the Paseo worker, with authorization. Original transcripts are never edited.
