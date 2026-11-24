# Agent2TaskPlugins

[简体中文](./README.zh-CN.md)

Open-source **Scheduled Task Plugins** for [Agent2API](https://github.com/aimod-cc/Agent2API).

Every plugin in this repository is a sandboxed single-file JavaScript plugin (`/* @agent2api-task-plugin ... */`). Agent2API automatically renders the declared form inputs, encrypted password fields, custom action buttons, and status summaries natively across desktop, web, and mobile clients.

## Plugins

| Plugin | ID | Description | Entry |
| --- | --- | --- | --- |
| New API Login Keep-Alive & Check-In | `agent2api-task-newapi-login-checkin` | Configurable URL, account, and encrypted password for New API / One API compatible sites; maintains login sessions, queries remaining quota, and supports scheduled keep-alive or check-in. | [`plugins/newapi-login-checkin/script.js`](./plugins/newapi-login-checkin/script.js) |

## Quick Import

1. Open Agent2API → **Plugins** → filter **Scheduled task plugins** → click **Import script / ZIP**.
2. Upload any `plugins/<name>/script.js` file (or paste its contents directly).
3. Click **New task** on the plugin card, enter your site URL, account, and password (stored encrypted), and click **Verify login**.

## Packaging & Validation

Validate plugin manifests and build distributable `{id}-{version}-task-script.zip` archives (requires Node.js 20+):

```bash
node scripts/pack.mjs
```

Optional official Ed25519 signing via environment variables:

```bash
AGENT2API_PLUGIN_KEY_PEM="..." AGENT2API_PLUGIN_KEY_ID="official-2026" node scripts/pack.mjs
```

## License

[AGPL-3.0-only](./LICENSE)
