# Agent Note: Enforce todo freshness at tool admission

Status: implemented

English | [中文](2026-08-14-enforce-todo-freshness.zh.md)

## Problem

`todo_write` asks the model to mark each item complete when it finishes and not batch transitions, but the runtime previously enforced only the list schema. Real multi-step sessions wrote an initial list, ran dozens of tools across several completed items, and then replaced several statuses together near the end. The Web projection correctly rendered every durable update; the missing facts were never appended.

Prompt wording cannot make task status observable when the model omits the bookkeeping call. The runtime needs a bounded point at which stale status interrupts further work, without guessing which task a shell command, file edit, subagent, or Code Mode program completed.

## Decision

The shipped base composition mounts `@deepseek-ai/dsh-todo-freshness-guard` beside `tool-todo`. The plugin treats the current turn's latest unfinished `todo/write` as one freshness epoch and reserves non-bookkeeping tool attempts at `tools/pre-execute`. At five attempts it attaches one plugin-sourced reminder through `tools/post-execute`; eight attempts may complete, and later attempts are denied until another successful `todo/write` replaces the complete list. These values reuse the existing loop-hygiene escalation band and leave three correction opportunities after the reminder.

Admission increments before execution, so parallel calls cannot all pass against the same stale count. The reminder reservation retains the epoch object; a concurrent `todo/write` replaces that object and suppresses the obsolete reminder when the earlier tool settles. Every `todo/write` event resets the counter even when the values are identical, a completed-only list disables the epoch, and `turn/start` clears it in the same place as the todo projection.

`todo_write` is always exempt. A root `run_code` call is also exempt because Code Mode can reach `todo_write` only through that transport; its parented SDK sub-dispatches consume the budget instead. This counts the actual operations once, lets a program recover by reconciling the list, and applies the same policy to native and Code Mode agents. Calls without an agent have no session-owned task state and remain outside the policy.

The counter is process-local. First observation backscans the current turn for its latest `todo/write`, so mounting or resuming under an unfinished list activates enforcement, but hydration grants a fresh budget rather than reconstructing an unlogged policy counter.

## Alternatives considered

**Strengthen the tool description only.** Rejected: the description already says to update immediately and not batch completions; the observed event logs prove instruction alone does not produce the missing writes.

**Infer task transitions from tool results.** Rejected: task items have no declared ownership relation to arbitrary tools, and guessing would write false durable facts. A bounded reconciliation request preserves model judgment while making omission finite.

**Extend `repeat-tool-reminder`.** Rejected: exact-call repetition and todo freshness have different state keys, resets, exemptions, and enforcement. Keeping separate plugins lets deployments tune or remove either policy without coupling two unrelated heuristics.

**Block the root `run_code` call.** Rejected: under Code Mode that removes the only route to the SDK binding that resolves the violation. Counting parented sub-dispatches enforces work while preserving recovery.

**Use elapsed time.** Rejected: no model step runs while a long tool is in flight, so a timer cannot obtain a reconciliation call and would classify slow I/O as stale status. Tool admission is the point where the agent can choose `todo_write` instead.

## Consequences

An unfinished list is no longer passive UI metadata: it constrains later tool admission. Long single-item work must write an unchanged heartbeat at the configured interval, adding small context and tool-call overhead in exchange for current observable state.

The guard deliberately does not require a status value to change. This avoids fabricating progress and permits genuinely long tasks, while each acknowledgment opens only another bounded epoch. Work before the first unfinished list remains unaffected.

Native loop tests pin reminder, denial, reset, completed-list, and disposal behavior; a real Code Mode runtime fixture pins the root-transport exemption and parented SDK enforcement; a Loader composition test pins required configuration; the ACP keyless snapshot pins the attributed reminder and denied result in an assembled transcript.
