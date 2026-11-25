/* @agent2api-task-plugin
{
  "id": "agent2api-task-newapi-login-checkin",
  "name": "New API 登录保活与签到",
  "version": "1.0.0-beta.1",
  "description": "面向 New API / One API 类站点（如 AgentRouter 等），支持可配置网址、账号与加密密码，自动维护登录会话、查询剩余额度并按计划执行保活或签到。",
  "defaultCron": "0 9 * * *",
  "defaultTimezone": "Asia/Shanghai",
  "defaultTimeout": 60,
  "permissions": {
    "domains": ["*"],
    "notify": true
  },
  "fields": [
    {
      "key": "baseUrl",
      "label": "站点网址",
      "type": "text",
      "required": true,
      "placeholder": "https://agentrouter.org",
      "description": "填写站点根地址，不要包含 /api 路径"
    },
    {
      "key": "username",
      "label": "登录账号",
      "type": "text",
      "required": true,
      "placeholder": "用户名或邮箱"
    },
    {
      "key": "password",
      "label": "登录密码",
      "type": "password",
      "required": true,
      "secret": true,
      "placeholder": "密码将自动加密保存"
    },
    {
      "key": "mode",
      "label": "定时执行模式",
      "type": "segmented",
      "defaultValue": "login_keepalive",
      "options": [
        { "value": "login_keepalive", "label": "登录保活 + 查额度" },
        { "value": "login_and_checkin", "label": "登录 + 自动签到" }
      ]
    },
    {
      "key": "notifyPolicy",
      "label": "系统通知策略",
      "type": "select",
      "defaultValue": "on_error",
      "options": [
        { "value": "on_error", "label": "仅执行失败时通知" },
        { "value": "always", "label": "每次定时执行都通知" },
        { "value": "off", "label": "不发送系统通知" }
      ]
    },
    {
      "key": "forceRelogin",
      "label": "每次定时都重新登录",
      "type": "switch",
      "group": "advanced",
      "defaultValue": false,
      "description": "开启后每次定时运行都会主动发起登录接口，适合需要通过登录动作保活或触发每日登录奖励的站点"
    },
    {
      "key": "loginPath",
      "label": "登录接口路径",
      "type": "text",
      "group": "advanced",
      "defaultValue": "/api/user/login?turnstile=",
      "placeholder": "/api/user/login?turnstile="
    },
    {
      "key": "selfPath",
      "label": "用户信息接口路径",
      "type": "text",
      "group": "advanced",
      "defaultValue": "/api/user/self",
      "placeholder": "/api/user/self"
    },
    {
      "key": "checkinPath",
      "label": "签到接口路径",
      "type": "text",
      "group": "advanced",
      "defaultValue": "/api/user/checkin",
      "placeholder": "/api/user/checkin",
      "when": { "key": "mode", "equals": "login_and_checkin" }
    },
    {
      "key": "quotaPerUnit",
      "label": "额度换算比例",
      "type": "number",
      "group": "advanced",
      "defaultValue": 500000,
      "min": 1,
      "max": 100000000,
      "unit": "额度 = $1",
      "description": "New API 默认 500000 额度等于 $1，如站点倍率不同可在此调整"
    }
  ],
  "actions": [
    {
      "id": "test_login",
      "label": "立即登录验证",
      "variant": "default",
      "placement": "footer"
    },
    {
      "id": "check_status",
      "label": "查询余额与状态",
      "variant": "outline",
      "placement": "footer"
    },
    {
      "id": "run_checkin",
      "label": "立即签到一次",
      "variant": "outline",
      "placement": "footer"
    },
    {
      "id": "clear_session",
      "label": "清除登录态",
      "variant": "destructive",
      "placement": "footer",
      "confirm": "确定清除当前任务缓存的 Cookie 和用户会话吗？"
    }
  ],
  "statusFields": [
    { "key": "account", "label": "账号状态" },
    { "key": "quota", "label": "剩余额度" },
    { "key": "lastResult", "label": "最近结果" }
  ]
}
*/

const SESSION_KEY = 'newapi_session_v1';

function normalizeBaseUrl(raw) {
  const trimmed = String(raw || '').trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error('请先填写站点网址');
  }
  if (!/^https?:\/\/[^/\s]+/i.test(trimmed)) {
    throw new Error('站点网址格式不正确，请以 https:// 或 http:// 开头');
  }
  return trimmed;
}

function joinUrl(baseUrl, pathPart) {
  const path = String(pathPart || '').trim();
  if (!path) return baseUrl;
  if (/^https?:\/\//i.test(path)) return path;
  return path.startsWith('/') ? `${baseUrl}${path}` : `${baseUrl}/${path}`;
}

function extractCookies(response) {
  const list = Array.isArray(response.setCookies) && response.setCookies.length > 0
    ? response.setCookies
    : (response.headers && response.headers['set-cookie']
      ? [String(response.headers['set-cookie'])]
      : []);

  const pairs = [];
  const seen = new Set();
  for (const rawLine of list) {
    const firstPart = String(rawLine || '').split(';', 1)[0].trim();
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx <= 0) continue;
    const name = firstPart.slice(0, eqIdx).trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    pairs.push(firstPart);
  }
  return pairs.join('; ');
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function formatQuota(rawQuota, quotaPerUnit) {
  const num = Number(rawQuota);
  if (!Number.isFinite(num)) return '—';
  const unit = Number(quotaPerUnit) > 0 ? Number(quotaPerUnit) : 500000;
  return `$${(num / unit).toFixed(2)}`;
}

function shortNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function readSession(ctx, baseUrl) {
  const raw = await ctx.storage.get(SESSION_KEY);
  if (!raw) return null;
  const parsed = parseJsonSafe(raw);
  if (!parsed || !parsed.cookie || !parsed.userId) return null;
  if (parsed.baseUrl && parsed.baseUrl !== baseUrl) return null;
  return parsed;
}

function buildAuthHeaders(session) {
  return {
    Cookie: session.cookie,
    'New-Api-User': String(session.userId),
  };
}

async function performLogin(ctx) {
  const baseUrl = normalizeBaseUrl(ctx.form.baseUrl);
  const username = String(ctx.form.username || '').trim();
  const password = String(ctx.form.password || '');
  if (!username) throw new Error('请先填写登录账号');
  if (!password) throw new Error('请先填写登录密码');

  const loginUrl = joinUrl(baseUrl, ctx.form.loginPath || '/api/user/login?turnstile=');
  ctx.log('发起登录请求:', loginUrl);

  const res = await ctx.http.post(
    loginUrl,
    { username, password },
    { headers: { Accept: 'application/json' } }
  );

  const data = parseJsonSafe(res.body);
  if (!res.ok || !data || !data.success || !data.data || !data.data.id) {
    const reason = (data && data.message) ? String(data.message) : `HTTP ${res.status}`;
    throw new Error(`登录失败：${reason}`);
  }

  const cookie = extractCookies(res);
  if (!cookie || !cookie.includes('=')) {
    throw new Error('登录成功，但响应中未返回会话 Cookie');
  }

  const user = data.data;
  const session = {
    baseUrl,
    cookie,
    userId: String(user.id),
    username: String(user.username || user.display_name || username),
    updatedAt: Date.now(),
  };

  await ctx.storage.set(SESSION_KEY, session);
  ctx.log('登录成功，用户 ID:', session.userId, '用户名:', session.username);
  return { session, user };
}

async function fetchSelfProfile(ctx, session) {
  const baseUrl = normalizeBaseUrl(ctx.form.baseUrl);
  const selfUrl = joinUrl(baseUrl, ctx.form.selfPath || '/api/user/self');
  const res = await ctx.http.get(selfUrl, {
    headers: {
      Accept: 'application/json',
      ...buildAuthHeaders(session),
    },
  });
  const data = parseJsonSafe(res.body);
  if (res.status === 401 || res.status === 403 || !data || !data.success || !data.data) {
    return { ok: false, status: res.status, message: (data && data.message) || `HTTP ${res.status}` };
  }
  return { ok: true, user: data.data };
}

async function ensureValidSession(ctx, forceRelogin) {
  const baseUrl = normalizeBaseUrl(ctx.form.baseUrl);
  if (!forceRelogin) {
    const cached = await readSession(ctx, baseUrl);
    if (cached) {
      const check = await fetchSelfProfile(ctx, cached);
      if (check.ok) {
        ctx.log('复用缓存会话有效，用户 ID:', cached.userId);
        return { session: cached, user: check.user, relogged: false };
      }
      ctx.log('缓存会话已失效，准备自动重新登录:', check.message);
    }
  }
  const fresh = await performLogin(ctx);
  const profile = await fetchSelfProfile(ctx, fresh.session);
  return {
    session: fresh.session,
    user: profile.ok ? profile.user : fresh.user,
    relogged: true,
  };
}

async function executeCheckin(ctx, session) {
  const baseUrl = normalizeBaseUrl(ctx.form.baseUrl);
  const checkinUrl = joinUrl(baseUrl, ctx.form.checkinPath || '/api/user/checkin');
  ctx.log('请求签到接口:', checkinUrl);

  const res = await ctx.http.post(checkinUrl, {}, {
    headers: {
      Accept: 'application/json',
      ...buildAuthHeaders(session),
    },
  });
  const data = parseJsonSafe(res.body);
  if (res.status === 404) {
    return { supported: false, message: '该站点未开放此签到接口（HTTP 404），已保持登录保活' };
  }
  if (!res.ok) {
    const msg = (data && data.message) ? String(data.message) : `HTTP ${res.status}`;
    return { supported: true, ok: false, unauthorized: res.status === 401 || res.status === 403, message: msg };
  }
  if (data && data.success === false) {
    const msg = String(data.message || '签到未成功');
    const already = /已签到|already|重复|signed/i.test(msg);
    return { supported: true, ok: already, already, message: msg };
  }
  const msg = (data && data.message) ? String(data.message) : '签到成功';
  return { supported: true, ok: true, already: false, message: msg };
}

async function maybeNotify(ctx, isError, title, body) {
  const policy = String(ctx.form.notifyPolicy || 'on_error');
  if (policy === 'off') return;
  if (policy === 'on_error' && !isError) return;
  try {
    await ctx.notify.send(title, body);
  } catch (err) {
    ctx.log('通知发送跳过或失败:', err && err.message ? err.message : String(err));
  }
}

export async function onAction(action, ctx) {
  const quotaUnit = ctx.form.quotaPerUnit || 500000;

  if (action === 'clear_session') {
    await ctx.storage.delete(SESSION_KEY);
    ctx.log('已清空缓存登录态');
    return {
      level: 'info',
      message: '已清除缓存的会话 Cookie 与用户 ID',
      status: {
        account: '未登录',
        quota: '—',
        lastResult: `已清理 · ${shortNow()}`,
      },
    };
  }

  if (action === 'test_login') {
    const { session, user } = await performLogin(ctx);
    const profile = await fetchSelfProfile(ctx, session);
    const finalUser = profile.ok ? profile.user : user;
    const quotaText = formatQuota(finalUser && finalUser.quota, quotaUnit);
    return {
      level: 'success',
      message: `登录成功！用户 ${session.username}（ID: ${session.userId}），剩余额度 ${quotaText}`,
      status: {
        account: `已登录 · ID ${session.userId}`,
        quota: quotaText,
        lastResult: `登录验证通过 · ${shortNow()}`,
      },
    };
  }

  if (action === 'check_status') {
    const { session, user, relogged } = await ensureValidSession(ctx, false);
    const quotaText = formatQuota(user && user.quota, quotaUnit);
    const usedText = formatQuota(user && user.used_quota, quotaUnit);
    return {
      level: 'success',
      message: `${relogged ? '会话已刷新。' : ''}用户 ${session.username}（ID: ${session.userId}），剩余额度 ${quotaText}，已用 ${usedText}`,
      status: {
        account: `已登录 · ID ${session.userId}`,
        quota: quotaText,
        lastResult: `状态正常 · ${shortNow()}`,
      },
    };
  }

  if (action === 'run_checkin') {
    let { session, user } = await ensureValidSession(ctx, false);
    let result = await executeCheckin(ctx, session);
    if (result.unauthorized) {
      const fresh = await performLogin(ctx);
      session = fresh.session;
      result = await executeCheckin(ctx, session);
    }
    const profile = await fetchSelfProfile(ctx, session);
    if (profile.ok) user = profile.user;
    const quotaText = formatQuota(user && user.quota, quotaUnit);

    if (!result.supported) {
      return {
        level: 'warning',
        message: result.message,
        status: {
          account: `已登录 · ID ${session.userId}`,
          quota: quotaText,
          lastResult: `仅保活 · ${shortNow()}`,
        },
      };
    }
    if (!result.ok) {
      throw new Error(`签到失败：${result.message}`);
    }
    return {
      level: 'success',
      message: `${result.message}（剩余额度 ${quotaText}）`,
      status: {
        account: `已登录 · ID ${session.userId}`,
        quota: quotaText,
        lastResult: `${result.already ? '今日已签' : '签到成功'} · ${shortNow()}`,
      },
    };
  }

  throw new Error(`未知按钮操作：${action}`);
}

export async function onSchedule(ctx) {
  const taskName = ctx.task.name || 'New API 定时任务';
  const mode = String(ctx.form.mode || 'login_keepalive');
  const forceRelogin = Boolean(ctx.form.forceRelogin);
  const quotaUnit = ctx.form.quotaPerUnit || 500000;

  try {
    let { session, user, relogged } = await ensureValidSession(ctx, forceRelogin);
    let summaryText = relogged ? '已重新登录并确认会话有效' : '会话有效，保活成功';
    let shortTag = '保活成功';

    if (mode === 'login_and_checkin') {
      let result = await executeCheckin(ctx, session);
      if (result.unauthorized) {
        const fresh = await performLogin(ctx);
        session = fresh.session;
        result = await executeCheckin(ctx, session);
      }
      if (!result.supported) {
        summaryText = result.message;
        shortTag = '保活成功';
      } else if (!result.ok) {
        throw new Error(`签到失败：${result.message}`);
      } else {
        summaryText = result.message;
        shortTag = result.already ? '今日已签' : '签到成功';
      }
      const profile = await fetchSelfProfile(ctx, session);
      if (profile.ok) user = profile.user;
    }

    const quotaText = formatQuota(user && user.quota, quotaUnit);
    const fullMessage = `${summaryText}｜用户 ${session.username}（ID: ${session.userId}）｜剩余额度 ${quotaText}`;
    ctx.log(fullMessage);
    await maybeNotify(ctx, false, `${taskName} · ${shortTag}`, fullMessage);

    return {
      level: 'success',
      message: fullMessage,
      status: {
        account: `已登录 · ID ${session.userId}`,
        quota: quotaText,
        lastResult: `${shortTag} · ${shortNow()}`,
      },
    };
  } catch (err) {
    const errMsg = err && err.message ? err.message : String(err);
    await maybeNotify(ctx, true, `${taskName} · 执行失败`, errMsg);
    throw err;
  }
}
