# Agent2TaskPlugins

[English](./README.md)

[Agent2API](https://github.com/aimod-cc/Agent2API) 的开源 **定时任务类插件** 仓库。

本仓库中的每个插件均为内置沙箱轻量脚本插件（单文件 `.js`），通过头部声明定义表单输入框、加密密码字段、操作按钮和状态指标，由 Agent2API 在桌面端、网页端和移动端自动渲染统一界面，无需在脚本代码里硬编码账号密码。

## 已收录插件

| 插件名称 | 插件标识 | 功能说明 | 插件文件 |
| --- | --- | --- | --- |
| New API 登录保活与签到 | `agent2api-task-newapi-login-checkin` | 支持自由配置站点网址、账号与加密密码，适用于 New API / One API 类站点，自动维护登录会话、查询剩余额度并定时执行保活或签到 | [`plugins/newapi-login-checkin/script.js`](./plugins/newapi-login-checkin/script.js) |

## 快速导入使用

1. 打开 Agent2API → 进入侧边栏 **「定时任务」** → **「任务插件」**（或在侧边栏 **「插件 → 其他插件 → 定时任务」** 中管理）→ 点击 **「导入脚本/包」**，选择本仓库中的 `script.js` 或打包好的 `.zip` 文件（`.zip` 包也支持直接在 **「插件 → 更多操作 → 从文件安装」** 中拖入安装）。
2. 在插件卡片上点击 **「建任务」**，填写站点网址、账号和密码（自动加密保存），点击 **「立即登录验证」** 即可。

## 本地校验与打包

使用 Node.js 20+ 一键校验全部插件格式并生成商店分发包 `{id}-{version}-task-script.zip` 及 `.sha256`：

```bash
# 仅校验元数据与语法（不写出 dist/）
node scripts/pack.mjs --check-only

# 打包全部或指定插件
node scripts/pack.mjs [plugin]
```

如需附加官方 Ed25519 签名（用于官方商店发布），传入签名密钥 JSON 文件或环境变量即可；推送 `task-<plugin>-v<version>` 标签后工作流会自动完成签名打包、GitHub Release 发布与官网商店同步：

```bash
node scripts/pack.mjs --key /path/to/plugin-signing-key.json --require-signature
```

## 开源协议

本项目采用 [AGPL-3.0-only](./LICENSE) 开源协议。
