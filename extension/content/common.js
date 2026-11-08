/* Creator Guard - shared page helpers (isolated world) */
(() => {
  if (window.__CG_COMMON__) return;
  window.__CG_COMMON__ = true;

  const CG = {};

  CG.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  CG.rand = (min, max) => Math.floor(min + Math.random() * (max - min + 1));
  CG.clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  CG.hash = (text) => {
    let hash = 2166136261;
    const value = String(text || "");
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  };

  CG.normalize = (text) => String(text || "").replace(/\s+/g, " ").trim();
  CG.textOf = (el) => CG.normalize(el && (el.innerText || el.textContent || ""));

  CG.isVisible = (el) => {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0;
  };

  CG.waitFor = async (predicate, timeout = 8000, interval = 250) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        if (predicate()) return true;
      } catch (_) {
        /* keep waiting */
      }
      await CG.sleep(interval);
    }
    return false;
  };

  CG.send = (type, payload = {}) =>
    new Promise((resolve, reject) => {
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

  CG.api = (path, method = "GET", body = null) =>
    CG.send("cg:api", { path, method, body });
  CG.getConfig = () => CG.send("cg:getConfig");
  CG.setConfig = (patch) => CG.send("cg:setConfig", { patch });
  CG.log = (...args) => {
    try {
      console.debug("[CreatorGuard]", ...args);
    } catch (_) {
      /* ignore */
    }
    CG.send("cg:log", { message: args.map((x) => String(x)).join(" ") }).catch(() => {});
  };

  CG.isActiveHours = (config) => {
    const start = Number(config.activeStartHour ?? 9);
    const end = Number(config.activeEndHour ?? 23);
    const hour = new Date().getHours();
    if (start === end) return true;
    if (start < end) return hour >= start && hour < end;
    return hour >= start || hour < end;
  };

  CG.pageVisible = () => document.visibilityState === "visible";

  CG.humanReadingDelay = (textLength) => {
    const base = 1400 + Math.min(textLength * 38, 6000);
    return Math.round(base * (0.8 + Math.random() * 0.5));
  };

  CG.betweenItemsDelay = () => CG.rand(3200, 7800);

  CG.escapeSelector = (value) => {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/["\\]/g, "\\$&");
  };

  CG.formatTime = (iso) => {
    if (!iso) return "未知";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  CG.el = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null) continue;
      if (key === "className") node.className = value;
      else if (key === "textContent") node.textContent = value;
      else if (key === "style") node.style.cssText = value;
      else if (key === "dataset") Object.assign(node.dataset, value);
      else node.setAttribute(key, value);
    }
    for (const child of children) {
      if (child === null || child === undefined) continue;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
  };

  CG.createPanel = ({ id, title, position = "top-right" }) => {
    const old = document.getElementById(id);
    if (old) old.remove();

    const host = document.createElement("div");
    host.id = id;
    host.style.cssText = [
      "all:initial",
      "position:fixed",
      position === "bottom-right" ? "bottom:16px" : "top:16px",
      "right:16px",
      "z-index:2147483647",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif",
    ].join(";");
    document.documentElement.appendChild(host);

    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host{all:initial}
        *{box-sizing:border-box}
        .wrap{width:328px;max-height:72vh;display:flex;flex-direction:column;background:#fff;color:#1f2937;
          border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 12px 36px rgba(15,23,42,.18);overflow:hidden;
          font-size:13px;line-height:1.55}
        .head{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#0f172a;color:#fff;cursor:default}
        .head b{font-size:13px;font-weight:650;letter-spacing:.2px;flex:1}
        .dot{width:7px;height:7px;border-radius:99px;background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.18)}
        .dot.warn{background:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.18)}
        .dot.bad{background:#ef4444;box-shadow:0 0 0 3px rgba(239,68,68,.18)}
        .head button{border:0;background:rgba(255,255,255,.12);color:#fff;border-radius:6px;width:24px;height:24px;
          cursor:pointer;font-size:14px;line-height:1}
        .head button:hover{background:rgba(255,255,255,.22)}
        .body{padding:11px 12px;overflow:auto;display:flex;flex-direction:column;gap:9px}
        .foot{padding:7px 12px;border-top:1px solid #f1f5f9;color:#64748b;font-size:11px;background:#fafafa}
        .row{display:flex;align-items:center;justify-content:space-between;gap:8px}
        .status{font-weight:650;color:#0f172a}
        .small{font-size:11px;color:#64748b}
        .btns{display:flex;gap:7px;flex-wrap:wrap}
        .btns button{border:1px solid #d1d5db;background:#fff;color:#111827;border-radius:7px;padding:5px 9px;
          font-size:12px;cursor:pointer}
        .btns button:hover{background:#f8fafc}
        .btns button.primary{background:#0f172a;color:#fff;border-color:#0f172a}
        .btns button.primary:hover{background:#1e293b}
        .headline{font-size:14px;font-weight:700;color:#0f172a;line-height:1.45}
        .section-title{font-size:11px;font-weight:700;color:#64748b;letter-spacing:.4px;margin-top:2px}
        .suggestion{display:flex;gap:7px;align-items:flex-start;padding:7px 8px;background:#f0fdf4;border:1px solid #dcfce7;
          border-radius:8px;color:#14532d;font-size:12px}
        .suggestion .num{font-weight:800;color:#16a34a}
        .bar-row{display:grid;grid-template-columns:86px 1fr 40px;gap:7px;align-items:center;font-size:11px;color:#475569}
        .bar{height:7px;background:#eef2f7;border-radius:99px;overflow:hidden}
        .bar i{display:block;height:100%;background:#3b82f6;border-radius:99px}
        .chips{display:flex;flex-wrap:wrap;gap:5px}
        .chip{padding:2px 7px;border-radius:99px;background:#f1f5f9;color:#334155;font-size:11px}
        .warnbox{padding:7px 8px;border-radius:8px;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;font-size:11px}
        .empty{padding:10px;border-radius:8px;background:#f8fafc;color:#64748b;font-size:12px;text-align:center}
        .wrap.collapsed .body,.wrap.collapsed .foot{display:none}
      </style>
      <div class="wrap">
        <div class="head">
          <span class="dot"></span><b></b>
          <button class="min" title="折叠">—</button>
          <button class="close" title="关闭面板">×</button>
        </div>
        <div class="body"></div>
        <div class="foot">本地分析 · 文本不上传云端 · 只标注，不自动回复</div>
      </div>`;

    const wrap = shadow.querySelector(".wrap");
    const dot = shadow.querySelector(".dot");
    const titleEl = shadow.querySelector(".head b");
    const body = shadow.querySelector(".body");
    const foot = shadow.querySelector(".foot");
    titleEl.textContent = title;

    shadow.querySelector(".close").addEventListener("click", () => host.remove());
    shadow.querySelector(".min").addEventListener("click", () => wrap.classList.toggle("collapsed"));

    return {
      host,
      shadow,
      body,
      setStatus(text, tone = "") {
        dot.className = "dot" + (tone ? ` ${tone}` : "");
        const current = body.querySelector("[data-cg-status]");
        if (current) current.textContent = text;
      },
      setFooter(text) {
        foot.textContent = text;
      },
      clearBody() {
        body.replaceChildren();
      },
      onAction(handler) {
        shadow.addEventListener("click", (event) => {
          const button = event.target.closest("[data-act]");
          if (button) handler(button.dataset.act);
        });
      },
    };
  };

  window.CG = CG;
})();
