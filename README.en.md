# DSH Codex Experience

[简体中文](README.md) | English

Codex-style answer annotations, ephemeral side chat, and todo freshness enforcement for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — shipped as community plugins **plus two small core patches** the annotation experience needs. DeepSeek Harness does not yet expose the two transcript extension points the plugins render through, so this repository carries them as a clean patch against upstream `master` (see `patches/`) alongside the plugin sources. Once upstream ships equivalent seams, the patches retire and this becomes a plain plugin repository.

## Packages

| Package | Role |
| --- | --- |
| [`dsh-codex-conversation`](packages/codex-conversation) | Select assistant text, stage multiple annotations in the main composer, jump back to quoted answers, and ask follow-ups in an ephemeral details-panel conversation. |
| [`dsh-todo-freshness-guard`](packages/todo-freshness-guard) | Remind the agent when an active `todo_write` list becomes stale, then deny ordinary tools until the complete list is reconciled. |
| [`dsh-codex-pack`](packages/codex-pack) | Bundle that installs both plugins with the recommended defaults. |

The packages remain independent. The Web plugin does not require the Guard, and the Guard does not require the Web UI.

## Compatibility

- DeepSeek Harness: `master` (rc.8 line) with `patches/0001-transcript-extension-seams.patch` applied
- Node.js: `^22.19.0 || >=24.0.0`
- Package status: community preview

DeepSeek Harness is in developer preview and may introduce breaking plugin API changes. The plugin sources assume three host capabilities: the ephemeral side-chat session fork, the `conversation.chat.user-body` bubble chain, and the `chatInlineDirectives` prose vocabulary. The latter two are provided by the bundled patch — 293 additive lines against upstream `master`, verified by the upstream test suites for both touched packages. On a harness without the two transcript seams the annotation feature degrades to literal text display only: the sent message format is identical, and existing transcripts upgrade in place on a patched harness (`packages/codex-conversation/src/client/harness-compat.ts` documents the mechanism). The published `0.1.0-rc.6` npm packages predate the side-chat session APIs entirely, so this tree does not compile against them.

## Applying the core patch

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
git apply --3way path/to/dsh-codex-experience/patches/0001-transcript-extension-seams.patch
pnpm install && pnpm build
```

The patch adds two generic extension points and carries its own tests; it never mentions annotations. A feature proposal to upstream these seams is tracked in the DeepSeek Harness GitHub Discussions.

## Install from a checkout

Until the packages are published to npm, install the built checkout into a DSH profile:

```sh
git clone https://github.com/lamost423/dsh-codex-experience.git
cd dsh-codex-experience
corepack enable
pnpm install --frozen-lockfile
pnpm build
dsh plugin --profile web add ./packages/codex-pack
dsh web
```

Install only one capability by replacing `./packages/codex-pack` with `./packages/codex-conversation` or `./packages/todo-freshness-guard`.

Inspect the resulting composition:

```sh
dsh web --dump-config
```

Remove the combined bundle:

```sh
dsh plugin --profile web remove dsh-codex-pack
```

## Conversation workflow

1. Select text in an assistant answer.
2. Choose **Add to conversation** to stage an annotation, or **Ask in side chat** to open a temporary child conversation.
3. Add zero or more inline annotation questions and repeat for other passages.
4. Submit once from the main composer. The model receives explicit source links, quoted-answer fields, annotation questions, and any main-composer supplement.

Side chat uses an ephemeral fork of the parent Session. It stays in the current task's details column, never switches the main Session, and is discarded when the panel closes.

## Todo freshness policy

The default policy starts after an unfinished `todo_write` list exists:

```yaml
reminderAfterCalls: 5
blockAfterCalls: 8
```

Native tool calls and Code Mode sub-dispatches share the counter. `todo_write` always remains reachable, and the outer `run_code` transport remains reachable so Code Mode can call it.

Override the Guard row in a later profile patch when different thresholds are required.

## Development

```sh
pnpm install
pnpm check
pnpm pack:all
```

`pnpm check` runs TypeScript validation, unit and component tests, and production builds. Generated tarballs land in `artifacts/`.

## Provenance and license

The initial implementations were developed against DeepSeek Harness and extracted into out-of-tree plugins. Derived portions retain the upstream MIT license; see [`NOTICE`](NOTICE) and [`LICENSE`](LICENSE).
