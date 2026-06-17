---
name: Task-agent phantom workflow desync
description: Why configureWorkflow can hit "limit exceeded (11/10)" listing workflows that removeWorkflow/getWorkflowStatus report "not found", and how to actually clear them.
---

## Symptom

In an isolated task-agent sandbox, `configureWorkflow` refuses to add a workflow with `Workflow limit exceeded (11/10)` and its "Current workflows" list includes entries (e.g. `EAS iOS Build 46`, `EAS Android Build`) that:
- do NOT appear in `listWorkflows()` (live run-service shows fewer, e.g. 9), and
- `removeWorkflow` / `getWorkflowStatus` report as `not found`.

## Why

Two different backends are out of sync. `configureWorkflow`'s limit counter reads the **main app's** workflow registry (the same set shown in the top-of-conversation "Configured Workflows" View), but `removeWorkflow`/`getWorkflowStatus`/`listWorkflows` operate on the **task copy's live run-service**. The phantom entries are real workflows in the MAIN app that the isolated sandbox can count but cannot mutate. They are NOT in `.replit` (agent/artifact-created workflows live only in the backend registry, never in `.replit`). `artifacts/*` dev workflows are also there and are "managed by an artifact and cannot be deleted via deleteRunWorkflow".

## How to apply / resolution

- A task agent CANNOT delete these from the sandbox. Don't waste turns retrying remove.
- Don't destroy the user's validation/dev workflows to free slots — the phantom slots are permanently stuck, so you couldn't restore them afterward (net loss).
- Real fix is owner/main-app action: remove the stale workflows from the **main app's** Workflows pane, or a full repl Stop→Run (restart) reconciles the registry. Only after the phantoms clear can a clean new workflow (e.g. "Push OTA (production)") be created.
- Meanwhile, deliver the actual goal (e.g. an OTA) via single-platform bash (see eas-ota-git-wrapper.md), which needs no managed workflow.
