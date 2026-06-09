---
name: Sandbox reaps background jobs between tool calls
description: Long-running CLI (eas build, big uploads) must run as a managed workflow, not nohup &, because background processes are killed when the launching bash tool call returns.
---

In this workspace sandbox, a process started with `nohup ... &` (or any `&` background job) inside a `bash` tool call is **terminated when that tool call returns**. The next tool call finds it already dead.

**Symptom seen:** an `eas build --no-wait` launched via nohup reached "Fetching Apple provisioning profiles" then died mid-upload; nothing queued on Expo, and the trailing cleanup/purge lines in the script never ran.

**Rule:** run any task that must outlive a single tool call (EAS builds, long uploads, anything beyond the ~120s bash tool timeout) as a **managed workflow** (`configureWorkflow`, `outputType: "console"`, `autoStart: true`), then poll with `getWorkflowStatus`. The workflow is supervised and persists across tool calls; it ran the same `eas build --no-wait` to completion (queued build df…, printed EAS_EXIT + purge) where nohup failed. Use bash only for work that finishes inside one call.

**Why:** background jobs are not detached from the tool-call process group, so the platform reaps them. Workflows are the only durable long-running primitive here.

**Bonus quirk confirmed same session:** EAS spinner lines (`⠋ Compressing project files`) do NOT update in captured workflow/bash logs — they look "stuck" on the first frame even while progressing. Don't diagnose a hang from a frozen spinner; confirm via `getWorkflowStatus` state flipping to `finished` or via `eas build:list`/`build:view`.
