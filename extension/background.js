/* Creator Guard - background service worker.
 * Content scripts never talk to the local server directly; all API calls go
 * through this worker. This keeps CORS simple and keeps the API base in one place.
 */

const DEFAULTS = Object.freeze({
  apiBase: "http://127.0.0.1:8765",
  autoOpenDm: false,
  autoCollectComments: false,
  hideFlaggedPreviews: true,
  skipOpenFlagged: true,
  maxDmPerSession: 20,
  dailyDmCap: 60,
  maxCommentScrolls: 30,
  activeStartHour: 9,
  activeEndHour: 23,
});

const logs = [];

function sanitizeConfig(input) {
  const next = { ...DEFAULTS, ...(input || {}) };
  next.apiBase = String(next.apiBase || DEFAULTS.apiBase).replace(/\/+$/, "");

  let url;
  try {
    url = new URL(next.apiBase);
  } catch (_) {
    throw new Error("本地服务地址格式不对");
  }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("为了隐私，只允许连接本机 127.0.0.1 / localhost");
  }
  next.apiBase = url.origin;

  for (const key of ["maxDmPerSession", "dailyDmCap", "maxCommentScrolls", "activeStartHour", "activeEndHour"]) {
    const value = Number(next[key]);
    if (!Number.isFinite(value)) throw new Error(`${key} 必须是数字`);
    next[key] = Math.round(value);
  }
  next.maxDmPerSession = Math.max(1, Math.min(50, next.maxDmPerSession));
  next.dailyDmCap = Math.max(1, Math.min(200, next.dailyDmCap));
  next.maxCommentScrolls = Math.max(1, Math.min(100, next.maxCommentScrolls));
  next.activeStartHour = Math.max(0, Math.min(23, next.activeStartHour));
  next.activeEndHour = Math.max(0, Math.min(23, next.activeEndHour));

  next.autoOpenDm = Boolean(next.autoOpenDm);
  next.autoCollectComments = Boolean(next.autoCollectComments);
  next.hideFlaggedPreviews = Boolean(next.hideFlaggedPreviews);
  next.skipOpenFlagged = Boolean(next.skipOpenFlagged);
  return next;
}

async function getConfig() {
  const stored = await chrome.storage.local.get("config");
  return sanitizeConfig(stored.config || {});
}

async function setConfig(patch) {
  const current = await getConfig();
  const next = sanitizeConfig({ ...current, ...(patch || {}) });
  await chrome.storage.local.set({ config: next });
  return next;
}

async function api(path, method = "GET", body = null) {
  const config = await getConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  try {
    const response = await fetch(config.apiBase + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === null || body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = { detail: text.slice(0, 500) };
    }
    if (!response.ok) {
      const detail = data && data.detail ? data.detail : `HTTP ${response.status}`;
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("本地服务 180 秒没有返回，可能模型正在处理，请稍后重试");
    }
    if (String(error.message || "").includes("Failed to fetch")) {
      throw new Error("连不上本地服务，请确认 start.bat 窗口还开着");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function pushLog(message) {
  logs.push({ at: new Date().toISOString(), message: String(message).slice(0, 1000) });
  if (logs.length > 100) logs.shift();
  console.log("[CreatorGuard]", message);
}

chrome.runtime.onInstalled.addListener(async () => {
  const config = await getConfig();
  await chrome.storage.local.set({ config });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message && message.type) {
      case "cg:api":
        return api(message.path, message.method || "GET", message.body ?? null);
      case "cg:getConfig":
        return getConfig();
      case "cg:setConfig":
        return setConfig(message.patch || {});
      case "cg:log":
        pushLog(message.message || "");
        return { ok: true };
      case "cg:getLogs":
        return { logs: logs.slice(-40) };
      default:
        throw new Error(`未知消息类型：${message && message.type}`);
    }
  })()
    .then((data) => sendResponse(data))
    .catch((error) => sendResponse({ error: String(error.message || error) }));
  return true;
});
