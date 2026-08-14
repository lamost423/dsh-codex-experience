# DeepSeek Harness

English | [中文](README.zh.md)

> This is the unofficial **DSH Codex Experience** community fork. It adds [Codex-style answer annotations and ephemeral side chat](packages/client/ui-side-chat/README.md) plus a [todo freshness Guard](packages/guard/todo-freshness-guard/README.md). The conversation feature depends on Client and Session extension points carried by this fork, so it is not installable on the official npm build as a standalone plugin.

## Run

### Run from source

Run the community fork from source:

```sh
git clone https://github.com/lamost423/dsh-codex-experience.git
cd dsh-codex-experience
corepack enable
pnpm install --frozen-lockfile
pnpm run build
pnpm dsh web
```

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## Developer preview

DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

The command starts this fork's Web UI at `http://127.0.0.1:3080` by default. The official `@deepseek-ai/dsh` npm package does not contain the fork's Side Chat extension points. See the [Web UI guide](docs/user/guide/index.md) for the shared upstream behavior.

## Community and support

- Report fork-specific defects and feature requests through this fork's [GitHub Issues](https://github.com/lamost423/dsh-codex-experience/issues).
- Use the upstream [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) for official DeepSeek Harness topics.
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
