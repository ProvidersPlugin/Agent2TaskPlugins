# Agent2TaskPlugins

[简体中文](./README.zh-CN.md)

Open-source **Scheduled Task Plugins** for [Agent2API](https://github.com/aimod-cc/Agent2API).

Every plugin in this repository is a sandboxed single-file JavaScript plugin (`/* @agent2api-task-plugin ... */`). Agent2API automatically renders the declared form inputs, encrypted password fields, custom action buttons, and status summaries natively across desktop, web, and mobile clients.

## Plugins

| Plugin | ID | Description | Entry |
| --- | --- | --- | --- |
| New API Login Keep-Alive & Check-In | `agent2api-task-newapi-login-checkin` | Configurable URL, account, and encrypted password for New API / One API compatible sites; maintains login sessions, queries remaining quota, and supports scheduled keep-alive or check-in. | [`plugins/newapi-login-checkin/script.js`](./plugins/newapi-login-checkin/script.js) |

## Quick Import

1. Open Agent2API → **Scheduled Tasks** → **Task Plugins** (or manage from **Plugins → Other plugins → Scheduled tasks**) → **Import script / ZIP**, then select a plugin's `script.js` or packaged `.zip` archive (`.zip` archives can also be dropped directly into **Plugins → More actions → Install from file**).
2. Click **New task** on the plugin card, enter your site URL, account, and password (stored encrypted), and click **Verify login**.

## Packaging & Validation

Validate plugin manifests and build distributable `{id}-{version}-task-script.zip` archives (requires Node.js 20+):

```bash
# Validate metadata and syntax only (without writing dist/)
node scripts/pack.mjs --check-only

# Package all or specified plugin directories
node scripts/pack.mjs [plugin]
```

To attach the official Ed25519 signature (used automatically when pushing a `task-<plugin>-v<version>` release tag):

```bash
node scripts/pack.mjs --key /path/to/plugin-signing-key.json --require-signature
```

## License

[AGPL-3.0-only](./LICENSE)
