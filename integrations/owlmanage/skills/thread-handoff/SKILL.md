---
name: thread-handoff
description: Write a durable transfer packet when the user requests a new-window continuation or a real goal, owner, authority or execution-environment handoff is required. Not for ordinary same-goal checkpoints, compaction or long threads.
---

# Thread Handoff

Create a compact transfer artifact only for a genuine takeover. Use `manage-thread-lifecycle` to resolve the semantic reason first unless the user explicitly requested the transfer.

Compaction, token count, thread age, a status question or a focused failure does not require transfer. A same-goal checkpoint belongs in the existing progress record; write it only when useful and continue the same task.

## Ground the packet

Read the current project truth and relevant receipts. Preserve the actual candidate, runtime, writer, authority, cwd/worktree, protected dirty work and recovery source. Separate verified state from assumptions; state any material unverified boundary instead of inventing fresh evidence.

Keep only information needed for safe continuation. Link current evidence rather than copying logs or chat history. Do not include secrets, grant new permissions or promote deferred findings into a new mainline.

## Include what the next owner needs

1. Goal and observable Done-when.
2. `Why Transfer Is Required`: the concrete owner, environment or outcome boundary.
3. Current verified truth and exact candidate/runtime identity as relevant.
4. Writer, authority, cwd/worktree, protected work and recovery boundaries.
5. Valid evidence and settled decisions that should not be reopened.
6. The dominant gap, one next action and the stop condition.
7. Key file and receipt pointers.
8. A starter prompt only when a new task will actually be opened.

Use the existing repo-local handoff convention, usually `docs/handoff/`. Keep the artifact proportional; do not target a page count.

## Finish the transfer

Check that paths and decision-relevant identities in the packet match the evidence. If a live candidate changes writer, preserve the old owner's recovery and responsibility until the new owner validates and acknowledges takeover; do not allow overlapping writes.

Give the user the file and specific transfer reason, then stop expansion in the old task. Do not create a new task, stage, commit or send external messages unless explicitly authorized.
