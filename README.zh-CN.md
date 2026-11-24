# Agent2TaskPlugins

[English](./README.md)

[Agent2API](https://github.com/aimod-cc/Agent2API) 的开源 **定时任务类插件** 仓库。

本仓库中的每个插件均为内置沙箱轻量脚本插件（单文件 `.js`），通过头部声明定义表单输入框、加密密码字段、操作按钮和状态指标，由 Agent2API 在桌面端、网页端和移动端自动渲染统一界面，无需在脚本代码里硬编码账号密码。

## 已收录插件

| 插件名称 | 插件标识 | 功能说明 | 插件文件 |
| --- | --- | --- | --- |
| New API 登录保活与签到 | `agent2api-task-newapi-login-checkin` | 支持自由配置站点网址、账号与加密密码，适用于 New API / One API 类站点，自动维护登录会话、查询剩余额度并定时执行保活或签到 | [`plugins/newapi-login-checkin/script.js`](./plugins/newapi-login-checkin/script.js) |

## 快速导入使用

1. 打开 Agent2API → 进入侧边栏 **「插件」** → 筛选 **「定时任务插件」** → 点击 **「导入脚本/包」**。
2. 选择本仓库中任意插件的 `script.js` 文件（或直接粘贴文件内容）完成导入。
3. 在插件卡片上点击 **「建任务」**，填写站点网址、账号和密码（自动加密保存），点击 **「立即登录验证」** 即可。

## 本地校验与打包

使用 Node.js 20+ 一键校验全部插件格式并生成商店分发包 `{id}-{version}-task-script.zip` 及 `.sha256`：

```bash
node scripts/pack.mjs
```

如需附加官方 Ed25519 签名（用于官方商店发布），传入环境变量即可：

```bash
AGENT2API_PLUGIN_KEY_PEM="..." AGENT2API_PLUGIN_KEY_ID="official-2026" node scripts/pack.mjs
```

## 开源协议

本项目采用 [AGPL-3.0-only](./LICENSE) 开源协议。
