const FIELDS = [
  "apiBase",
  "autoOpenDm",
  "autoCollectComments",
  "hideFlaggedPreviews",
  "skipOpenFlagged",
  "maxDmPerSession",
  "dailyDmCap",
  "maxCommentScrolls",
  "activeStartHour",
  "activeEndHour",
];

const BOOLEAN_FIELDS = new Set([
  "autoOpenDm",
  "autoCollectComments",
  "hideFlaggedPreviews",
  "skipOpenFlagged",
]);

const $ = (id) => document.getElementById(id);

function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response && response.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response);
    });
  });
}

let saveTimer = null;

function showSaveHint(text) {
  const hint = $("saveHint");
  hint.textContent = text;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    hint.textContent = "设置会自动保存";
  }, 2200);
}

async function saveConfig(patch) {
  try {
    await send("cg:setConfig", { patch });
    showSaveHint("已保存");
  } catch (error) {
    showSaveHint(`保存失败：${error.message}`);
  }
}

function readField(id) {
  const el = $(id);
  if (!el) return undefined;
  if (BOOLEAN_FIELDS.has(id)) return el.checked;
  if (el.type === "number") return Number(el.value);
  return el.value.trim();
}

function fillForm(config) {
  for (const id of FIELDS) {
    const el = $(id);
    if (!el) continue;
    if (BOOLEAN_FIELDS.has(id)) el.checked = Boolean(config[id]);
    else el.value = config[id] ?? "";
  }
}

function setStatus(kind, title, detail) {
  const dot = $("statusDot");
  dot.className = "status-dot" + (kind ? ` ${kind}` : "");
  $("statusTitle").textContent = title;
  $("statusDetail").textContent = detail;
}

async function testConnection() {
  setStatus("", "正在连接本地服务…", "请确认 start.bat 窗口没有关闭");
  try {
    const health = await send("cg:api", { path: "/api/health", method: "GET", body: null });
    const llm = health.llm || {};
    if (health.ok && llm.reachable && llm.model_present) {
      setStatus("ok", "本地服务 + 模型已就绪", `模型：${llm.model}`);
    } else if (health.ok && llm.reachable) {
      setStatus("", "Ollama 已启动，但模型未就绪", llm.detail || `请运行 ollama pull ${llm.model || "qwen2.5:7b-instruct"}`);
    } else {
      setStatus("bad", "本地服务已启动，但 Ollama 没连上", llm.detail || "请运行 ollama serve");
    }
  } catch (error) {
    setStatus("bad", "连不上本地服务", error.message);
  }
}

async function init() {
  try {
    const config = await send("cg:getConfig");
    fillForm(config);
    await testConnection();
  } catch (error) {
    setStatus("bad", "扩展初始化失败", error.message);
  }

  for (const id of FIELDS) {
    const el = $(id);
    if (!el) continue;
    const eventName = el.type === "text" || el.type === "number" ? "change" : "change";
    el.addEventListener(eventName, async () => {
      if (id === "autoOpenDm" && el.checked) {
        const ok = window.confirm(
          "自动展开会逐个点开未读私信，并让它们变成已读。\n\n" +
            "平台可能把自动化点击判定为异常行为，账号风险无法为零。\n" +
            "建议先用“只做预览标注”模式观察几天。\n\n" +
            "确定要开启吗？"
        );
        if (!ok) {
          el.checked = false;
          return;
        }
      }
      if (id === "autoCollectComments" && el.checked) {
        const ok = window.confirm(
          "自动滚动会模拟人慢慢往下翻评论区。\n\n" +
            "平台可能限制自动化行为，建议把“最多滚动屏数”控制在 30 以内。\n\n" +
            "确定要开启吗？"
        );
        if (!ok) {
          el.checked = false;
          return;
        }
      }
      await saveConfig({ [id]: readField(id) });
      if (id === "apiBase") await testConnection();
    });
  }

  $("testBtn").addEventListener("click", testConnection);

  $("openBili").addEventListener("click", () => {
    chrome.tabs.create({ url: "https://message.bilibili.com/" });
  });
  $("openXhs").addEventListener("click", () => {
    // Direct /im can spin forever for accounts without web IM access.
    // Open the home page first so the user can log in and use the message entry.
    chrome.tabs.create({ url: "https://www.xiaohongshu.com/" });
  });
}

document.addEventListener("DOMContentLoaded", init);
