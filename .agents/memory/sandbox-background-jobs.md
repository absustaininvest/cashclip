---
name: Sandbox reaps background jobs between tool calls
description: Long-running CLI (eas build, big uploads) must run as a managed workflow, not nohup &, because background processes are killed when the launching bash tool call returns.
---

In this workspace sandbox, a process started with `nohup ... &` (or any `&` background job) inside a `bash` tool call is **terminated when that tool call returns**. The next tool call finds it already dead.

**Symptom seen:** an `eas build --no-wait` launched via nohup reached "Fetching Apple provisioning profiles" then died mid-upload; nothing queued on Expo, and the trailing cleanup/purge lines in the script never ran.

**Rule:** run any task that must outlive a single tool call (EAS builds, long uploads, anything beyond the ~120s bash tool timeout) as a **managed workflow** (`configureWorkflow`, `outputType: "console"`, `autoStart: true`), then poll with `getWorkflowStatus`. The workflow is supervised and persists across tool calls; it ran the same `eas build --no-wait` to completion (queued build df…, printed EAS_EXIT + purge) where nohup failed. Use bash only for work that finishes inside one call.

**Why:** background jobs are not detached from the tool-call process group, so the platform reaps them. Workflows are the only durable long-running primitive here.

**Bonus quirk confirmed same session:** EAS spinner lines (`⠋ Compressing project files`) do NOT update in captured workflow/bash logs — they look "stuck" on the first frame even while progressing. Don't diagnose a hang from a frozen spinner; confirm via `getWorkflowStatus` state flipping to `finished` or via `eas build:list`/`build:view`.

**configureWorkflow add-cache can corrupt mid-session:** if `configureWorkflow` keeps failing "Workflow limit exceeded (11/10)" while listing workflows you already deleted (and `listWorkflows()` shows the real, lower count), its add-path is reading a frozen snapshot that a notebook restart does NOT clear. `.replit` is not directly editable. Workaround that works: repoint an EXISTING workflow's command at your script WITHOUT adding a new one — the cleanest is to temporarily overwrite the npm script that an existing workflow runs (e.g. cashclip `check:versions`), start it with the top-level `restart_workflow` tool (a real managed workflow, not reaped), poll `getWorkflowStatus`, then restore the npm script. Make the target script cwd-agnostic (`cd "$(dirname "${BASH_SOURCE[0]}")/.."`) since `pnpm --filter run` executes with cwd = the package dir.

**Two concurrent Metro bundlers OOM the box:** running an `eas update` export while the `cashclip: expo` dev workflow is also running spawns a second Metro and the 15Gi box gets OOM-killed (bash calls return `Killed`/exit -1). Stop the dev Metro (`pkill -f "expo start --localhost"`) before an OTA export, then restart it after.
