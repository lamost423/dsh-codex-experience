# Repository guidance

This repository contains out-of-tree DeepSeek Harness plugins. Keep the conversation UI, todo Guard, and combined bundle independently installable. Do not import or publish packages under the `@deepseek-ai` scope. Preserve the `dsh.bundle.patch` declarations and test against the explicit Harness version documented in the root README.

Run `pnpm check` before every push. Do not commit `lib/`, `artifacts/`, credentials, DSH profiles, or user Session data.

## Syncing from the annotated Harness fork

`packages/codex-conversation/src` mirrors the fork's `packages/client/ui-side-chat/src`, and `patches/0001-transcript-extension-seams.patch` mirrors the fork branch `upstream/transcript-seams`. When syncing, copy changed files from the fork and then restore the deliberate deviations below — they are this repository's adaptation layer, not drift to be overwritten:

| File | Deviation | Why |
| --- | --- | --- |
| `src/client/harness-compat.ts` | Exists here only | Type facade over host APIs the published npm line does not export; documents the literal-text degradation on unpatched hosts |
| `src/client/AnnotationMarker.tsx` | Imports `MarkdownInlineDirectives` from `./harness-compat.ts`, not `@deepseek-ai/dsh-client-ui-primitives` | The published npm packages do not export the type |
| `src/client/index.ts` | Extra `import type {} from './harness-compat.ts'` | Pulls the compat declaration merges into the build |
| `src/client/SideChatSelection.tsx`, `src/invariant.ts` | JSDoc wording differs | Text written for out-of-tree readers; keep whichever side was edited last |

Everything else under `src/` must match the fork byte-for-byte after a sync. A new fork-side file lands here unchanged unless it imports fork-only APIs, in which case route the import through `harness-compat.ts` and add it to this table.
