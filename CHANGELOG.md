# Changelog

## v0.2.1 — 2026-09-28

Todo Guard 兼容 DSH 0.1.7 / Todo Guard works on DSH 0.1.7

- 修复：DSH 0.1.7 的会话格式 4 拒收共享的 `plugin` 来源，Guard 注入提醒时整轮失败、该会话后续每一轮都失败。写格式 4 的宿主上提醒改用 `plugin:todo-freshness-guard`（与宿主迁移旧提醒得到的 kind 一致），格式 3 及以下的宿主保持原写法 / Fixed: DSH 0.1.7's Session format 4 refuses the shared `plugin` source, so the Guard's reminder failed the turn and every later turn of that Session. Hosts writing format 4 now get `plugin:todo-freshness-guard`, the kind their migration gives earlier reminders; hosts writing format 3 or older keep the shared wrapper.
- 修复：宿主从 0.1.2-alpha.4 起去掉了 `Session.events`。Guard 在一轮进行中被重新挂载（例如改了它的配置）后补读本轮待办时会抛错，这一轮剩下的普通工具调用全部失败。现在按宿主提供的读取方式补读，两种都没有时不启用约束 / Fixed: Hosts from 0.1.2-alpha.4 onward removed `Session.events`, so a Guard remounted mid-turn (for example after a configuration change) failed every remaining ordinary tool call of that turn while recovering the current todo list. It now reads through whichever Session log reader the Host offers and stays off when there is none.
- 升级：在 DSH 0.1.7 上已经遇到上述报错的会话，更新并重启 `dsh web` 后可以重新打开，出错那一轮记为中断，未写盘的部分无法找回。正在运行的宿主在重启前一直使用旧代码 / Upgrading: after updating, restart `dsh web`, because a running Host keeps the old code until it restarts. A Session hit by the error then reopens with that turn marked interrupted; its unsaved part cannot be recovered.

## v0.2.0 — 2026-08-23

结构化注释 v2：对话像引用，回答会回引 / Structured annotations v2: quotes in, citations back

- 注释以带标签的结构化块发送（说明 + `<response-annotations>` JSON + 请求标题），序列化与解析同一模块，气泡可从已发送文本完整重建 / Annotations travel as one tagged, machine-parseable block; serializer and parser share a module so the bubble is reconstructable from the sent text alone.
- 用户气泡渲染为编号引用卡片，逐条回链原回复；主输入框补充显示在卡片之下 / The user bubble renders numbered quote cards linking back to each source answer, with the main-composer supplement below.
- 模型按指令在回答中内联 `:dsh-annotation{index="N"}`，渲染为可点角标，点击跳回对应卡片——引用是双向的 / The model cites each annotation inline; citations render as clickable markers that jump to their card — quoting works in both directions.
- 修复：暂存第二条注释时，聚合 chip 重贴按单字符删除旧标签，污染草稿开头 / Fixed: staging a second annotation spliced the old aggregate chip out by one character, corrupting the draft head.
- 新增 `patches/0001-transcript-extension-seams.patch`：插件依赖的两个通用转录扩展点（用户气泡链 + 正文内联指令），对上游 `master` 293 行纯新增、与注释无关、含测试 / New `patches/`: the two generic transcript seams the plugin renders through, as one additive annotation-agnostic patch against upstream `master`, with tests.
- 兼容性重述：完整效果需要打补丁的 harness；未打补丁时降级为字面文本显示，消息格式不变，会话可原地升级 / Compatibility restated: full effect needs a patched harness; unpatched hosts degrade to literal text with an identical message format, transcripts upgrade in place.

## v0.1.0 — 2026-08-14

首个公开版本 / Initial public release

- Codex 风格回答注释：选中即暂存、聚合 chip、一次发送 / Codex-style answer annotations: select to stage, aggregate chip, single send.
- 临时侧边对话：基于父会话的临时 fork，关闭即弃 / Ephemeral side chat forked from the parent session, discarded on close.
- Todo 新鲜度约束：todo_write 列表过期时提醒并拦截普通工具 / Todo freshness guard: stale-list reminder and ordinary-tool denial.
