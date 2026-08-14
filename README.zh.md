# DeepSeek Harness

[English](README.md) | 中文

> 这是非官方的 **DSH Codex Experience** 社区 Fork，增加了 [Codex 风格的回答注释和临时侧边对话](packages/client/ui-side-chat/README.md)，以及 [Todo 新鲜度 Guard](packages/guard/todo-freshness-guard/README.md)。对话功能依赖本 Fork 提供的 Client 和 Session 扩展点，因此不能作为独立插件安装到官方 npm 构建上。

## 运行

### 从源码运行

从源码运行社区 Fork：

```sh
git clone https://github.com/lamost423/dsh-codex-experience.git
cd dsh-codex-experience
corepack enable
pnpm install --frozen-lockfile
pnpm run build
pnpm dsh web
```

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它采用**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

## 开发者预览

DeepSeek Harness 目前处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

该命令会启动本 Fork 的 Web UI，默认地址为 `http://127.0.0.1:3080`。官方 `@deepseek-ai/dsh` npm 包不包含本 Fork 的 Side Chat 扩展点。两者共用的上游功能说明见 [Web UI 指南](docs/user/guide/index.md)。

## 社区与支持

- 本 Fork 的缺陷和功能需求请提交到 [GitHub Issues](https://github.com/lamost423/dsh-codex-experience/issues)。
- 官方 DeepSeek Harness 相关话题请使用上游 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群：扫码添加企微小助手并填写入群问卷，完成后小助手会邀请你入群。

<table>
  <thead>
    <tr>
      <th align="center">企微小助手</th>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><img src="assets/community-wecom-assistant.png" alt="DeepSeek Harness 企微小助手二维码" width="180" height="180"></td>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="assets/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="assets/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 开发

请先阅读[开发指南](docs/development.md)与[架构文档](docs/architecture.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
