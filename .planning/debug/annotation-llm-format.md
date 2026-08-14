---
status: resolved
trigger: "User reports that answer annotations are ambiguous when serialized to the LLM."
created: 2026-08-14
updated: 2026-08-14
---

## Symptoms

- Expected behavior: The model must distinguish selected assistant-response text from the user's annotation question, while the transcript retains a clickable link to the source response.
- Actual behavior: The model receives a Markdown link, blockquote, and unlabelled prose, then treats the selected fragment as malformed page text rather than annotation context.
- Error messages: No transport error. The assistant reasoning shows the serialized Markdown was received but semantically misclassified.
- Timeline: Reproduced immediately after commit `c801a9596` introduced staged answer annotations.
- Reproduction: Select assistant text, choose “添加到对话”, enter an optional comment, then submit the main composer.

## Current Focus

- hypothesis: Confirmed. The reference codec used ambiguous prose/Markdown rather than explicit quote and user-question fields, and placed selected Markdown inside a dynamic link label.
- test: The codec regression test now asserts fixed source-link text plus explicit “引用内容” and “用户问题” sections for punctuation-heavy selected text and multiple annotations.
- expecting: Achieved. The serialized model prompt distinguishes quoted answer passages from user questions without putting selected text inside the link label.
- next_action: None; ready for parent review.
- reasoning_checkpoint: Screenshot and source inspection confirm newlines are preserved by the reference pipeline; the semantic envelope is the defect.
- tdd_checkpoint: red-to-green; the new regression failed before the codec change and passes afterward

## Evidence

- timestamp: 2026-08-14T17:30:00+08:00
  observation: `annotationBlock()` emits `[注释 N：snippet](#message)`, then a blockquote, then unlabelled comment prose.
- timestamp: 2026-08-14T17:30:00+08:00
  observation: `sinkSerialized()` splices codec output verbatim before trimming, so line breaks are not lost in transport.
- timestamp: 2026-08-14T17:55:03+08:00
  observation: Focused regression test fails because serialization emits the selected text inside the link label and leaves the comment unlabelled.

## Eliminated

- hypothesis: The input pipeline removes newlines before sending.
  reason: `sinkSerialized()` preserves the serialized string and only trims its outer whitespace.

## Resolution

- root_cause: `annotationBlock()` embedded the selected assistant text in a Markdown link label, then emitted the quote and optional comment without semantic field names. The transport preserved this text, but the model could not reliably distinguish source content from the user's question.
- fix: Serialize one shared Chinese instruction followed by numbered annotation sections. Each section uses fixed link text (`查看原回复`), an explicit `引用内容` blockquote, and an explicit `用户问题` value; empty per-annotation questions become `（未填写）`. The envelope ends with `主输入框补充问题（如有）` so text entered in the lower composer is also semantically separated.
- verification: Focused regression was observed failing first. The complete `ui-side-chat` suite passes 59 tests; client TypeScript build and package lint both pass; `git diff --check` passes.
- files_changed: `packages/client/ui-side-chat/src/client/annotations.ts`, `packages/client/ui-side-chat/tests/browser-plugin.client.spec.ts`, `packages/client/ui-side-chat/README.md`, `packages/client/ui-side-chat/README.zh.md`
