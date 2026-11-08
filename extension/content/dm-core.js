/* Creator Guard - DM page core.
 * Works on Bilibili message.bilibili.com and Xiaohongshu IM pages.
 * It only reads rendered DOM, clicks conversation items one at a time, and
 * writes badges/overlays. It never sends, blocks, reports, or replies.
 */
(() => {
  if (window.__CG_DM_CORE__) return;
  window.__CG_DM_CORE__ = true;

  const site = window.CG_SITE;
  if (!site || !window.CG_SELECTORS || !window.CG_SELECTORS[site]) return;
  const S = window.CG_SELECTORS[site].dm;
  const PLATFORM = site;

  const state = {
    running: false,
    paused: false,
    previewBusy: false,
    processed: new Map(),
    previewCache: new Map(),
    fullCache: new Map(),
    revealedKeys: new Set(),
    guardKey: null,
    sessionCount: 0,
    lastItemCount: 0,
    lastStatus: "",
  };

  let config = null;
  let panel = null;
  let maskEl = null;
  let maskTimer = null;

  // ---------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------
  function qa(root, selectors) {
    const out = [];
    if (!root) return out;
    for (const selector of selectors || []) {
      try {
        root.querySelectorAll(selector).forEach((el) => out.push(el));
      } catch (_) {
        /* invalid selector from a site update; skip it */
      }
    }
    return [...new Set(out)];
  }

  function safeClass(el) {
    if (!el) return "";
    const value = el.className;
    if (typeof value === "string") return value;
    if (value && typeof value.baseVal === "string") return value.baseVal;
    return "";
  }

  function isTimeLike(text) {
    return /^(\d{1,2}:\d{2}|昨天|前天|星期[一二三四五六日]|\d{1,2}月\d{1,2}日|\d{4}-\d{1,2}-\d{1,2})$/.test(
      CG.normalize(text)
    );
  }

  function isNameEl(el) {
    if (!el) return false;
    return S.name.some((selector) => {
      try {
        return el.matches(selector) || Boolean(el.closest(selector));
      } catch (_) {
        return false;
      }
    });
  }

  function isNoiseEl(el) {
    const cls = safeClass(el);
    return /avatar|nick|name|time|date|badge|unread|count|red-dot|dot|status|icon|emoji/i.test(cls);
  }

  function findList() {
    const candidates = qa(document, S.list)
      .filter(CG.isVisible)
      .filter((el) => !el.closest("#cg-dm-panel"));
    if (!candidates.length) return document.body;

    const scored = candidates.map((el) => {
      const items = qa(el, S.item).filter(CG.isVisible).length;
      const rect = el.getBoundingClientRect();
      return { el, items, area: rect.width * rect.height };
    });
    scored.sort((a, b) => b.items - a.items || b.area - a.area);
    return scored[0] && scored[0].items > 0 ? scored[0].el : document.body;
  }

  function findItems() {
    const list = findList();
    let items = qa(list, S.item);
    if (!items.length) items = qa(document, S.item);

    items = [...new Set(items)].filter((el) => {
      if (!CG.isVisible(el)) return false;
      if (el.closest("#cg-dm-panel")) return false;
      if (el.classList.contains("cg-badge")) return false;
      const rect = el.getBoundingClientRect();
      const text = CG.textOf(el);
      return rect.height >= 28 && rect.height <= 260 && text.length >= 2 && text.length <= 600;
    });

    // If nested selectors both match, keep the outer conversation item.
    items = items.filter(
      (el) => !items.some((other) => other !== el && el.contains(other) && !other.contains(el))
    );

    // Avoid treating a column of message bubbles as conversation items.
    const detail = findDetailPanel();
    if (detail) {
      const filtered = items.filter((el) => !detail.contains(el));
      if (filtered.length) items = filtered;
    }

    items.forEach((el) => {
      el.dataset.cgItem = "1";
    });
    return items;
  }

  function isUnread(item) {
    const badges = qa(item, S.unread).filter(CG.isVisible);
    for (const badge of badges) {
      if (badge.closest(".cg-badge")) continue;
      const text = CG.textOf(badge);
      if (/未读|new/i.test(text)) return true;
      if (/^\d+$/.test(text) && Number(text) > 0) return true;
      if (!text && /unread|red-dot/i.test(safeClass(badge))) return true;
    }
    if (/未读/.test(CG.textOf(item))) return true;
    return false;
  }

  function getName(item) {
    for (const selector of S.name) {
      let els = [];
      try {
        els = [...item.querySelectorAll(selector)];
      } catch (_) {
        continue;
      }
      for (const el of els) {
        if (!CG.isVisible(el) || el.closest(".cg-badge")) continue;
        const text = CG.textOf(el);
        if (text && text.length <= 40 && !isTimeLike(text) && !/^\d+$/.test(text)) {
          return text;
        }
      }
    }

    const leaves = [...item.querySelectorAll("*")].filter((el) => {
      if (el.children.length > 0 || !CG.isVisible(el)) return false;
      const text = CG.textOf(el);
      return text.length >= 1 && text.length <= 30 && !isTimeLike(text) && !isNoiseEl(el);
    });
    return leaves[0] ? CG.textOf(leaves[0]) : "";
  }

  function getPreviewEl(item) {
    const candidates = [];
    for (const selector of S.preview) {
      let els = [];
      try {
        els = [...item.querySelectorAll(selector)];
      } catch (_) {
        continue;
      }
      for (const el of els) {
        if (!CG.isVisible(el) || el.closest(".cg-badge")) continue;
        if (isNameEl(el)) continue;
        const text = CG.textOf(el);
        if (!text || text.length < 2 || text.length > 220 || isTimeLike(text)) continue;
        candidates.push(el);
      }
    }

    let pool = candidates;
    if (!pool.length) {
      pool = [...item.querySelectorAll("*")].filter((el) => {
        if (el.children.length > 0 || !CG.isVisible(el) || isNoiseEl(el)) return false;
        const text = CG.textOf(el);
        return text.length >= 3 && text.length <= 220 && !isTimeLike(text);
      });
    }
    if (!pool.length) return null;

    const scored = pool.map((el) => {
      const text = CG.textOf(el);
      const rect = el.getBoundingClientRect();
      let score = 0;
      if (el.children.length === 0) score += 30;
      if (rect.width > 40) score += 10;
      if (text.length > 8) score += 10;
      if (text.length > 40) score += 6;
      if (isNameEl(el)) score -= 100;
      return { el, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0] ? scored[0].el : null;
  }

  function getPreviewText(item) {
    const el = getPreviewEl(item);
    return el ? CG.textOf(el).slice(0, 300) : "";
  }

  function getKey(item) {
    if (item.dataset.cgKey) return item.dataset.cgKey;

    const attrs = ["data-conversation-id", "data-session-id", "data-user-id", "data-uid", "data-id"];
    for (const attr of attrs) {
      const value = item.getAttribute(attr);
      if (value && value.length <= 120) {
        const key = `${PLATFORM}:${value}`;
        item.dataset.cgKey = key;
        return key;
      }
    }

    const link = item.querySelector("a[href]");
    const href = link ? link.getAttribute("href") || "" : "";
    const matched = href.match(/(?:uid|user|conversation|session|id)[=/](\w{3,})/i);
    if (matched) {
      const key = `${PLATFORM}:${matched[1]}`;
      item.dataset.cgKey = key;
      return key;
    }

    // Name is more stable than preview: a new message changes the preview.
    const name = getName(item);
    const key = `${PLATFORM}:${CG.hash(name || getPreviewText(item).slice(0, 60))}`;
    item.dataset.cgKey = key;
    return key;
  }

  function findItemByKey(key) {
    return findItems().find((el) => getKey(el) === key) || null;
  }

  function wasProcessed(key) {
    const at = state.processed.get(key);
    if (!at) return false;
    if (Date.now() - at > 10 * 60 * 1000) {
      state.processed.delete(key);
      return false;
    }
    return true;
  }

  function findDetailPanel() {
    const candidates = qa(document, S.detail)
      .filter(CG.isVisible)
      .filter((el) => !el.closest("#cg-dm-panel"));

    const scored = candidates
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const bubbles = qa(el, S.bubble).filter(CG.isVisible).length;
        const text = CG.textOf(el);
        return {
          el,
          rect,
          text,
          score: bubbles * 100 + Math.min(text.length, 2500) + (rect.width * rect.height) / 20000,
        };
      })
      .filter((x) => x.rect.width > 260 && x.rect.height > 160 && x.text.length > 0);

    scored.sort((a, b) => b.score - a.score);
    return scored[0] ? scored[0].el : null;
  }

  function extractBubbles(panel) {
    let bubbles = qa(panel, S.bubble)
      .filter(CG.isVisible)
      .filter((el) => CG.textOf(el).length > 0);

    // Keep the deepest text nodes to avoid duplicated parent/child text.
    bubbles = bubbles.filter(
      (el) => !qa(el, S.bubble).some((child) => child !== el && CG.textOf(child).length > 0)
    );

    const seen = new Set();
    const out = [];
    for (const el of bubbles) {
      const text = CG.textOf(el);
      if (!text || text.length > 2000) continue;
      const rect = el.getBoundingClientRect();
      const uniqueKey = `${text}|${Math.round(rect.top)}`;
      if (seen.has(uniqueKey)) continue;
      seen.add(uniqueKey);
      const cls = `${safeClass(el)} ${safeClass(el.parentElement)}`;
      const mine = /(^|\s)(self|mine|right|send|out)(\s|$)|is-self|message-right/i.test(cls);
      out.push({ text, mine, top: rect.top });
    }
    out.sort((a, b) => a.top - b.top);
    return out;
  }

  function extractConversationText() {
    const panel = findDetailPanel();
    if (!panel) return "";
    const bubbles = extractBubbles(panel);
    let text;
    if (bubbles.length) {
      text = bubbles
        .slice(-40)
        .map((item) => `${item.mine ? "我" : "对方"}：${item.text}`)
        .join("\n");
    } else {
      text = CG.textOf(panel);
    }
    return text.replace(/\n{3,}/g, "\n\n").trim().slice(-6000);
  }

  function detailSignature() {
    const text = extractConversationText();
    return `${text.length}:${CG.hash(text.slice(-1400))}`;
  }

  // ---------------------------------------------------------------------
  // Mask over the chat detail pane
  // ---------------------------------------------------------------------
  function ensureMask() {
    if (maskEl && maskEl.isConnected) return maskEl;
    maskEl = document.createElement("div");
    maskEl.id = "cg-detail-mask";
    Object.assign(maskEl.style, {
      position: "fixed",
      zIndex: "2147483000",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "column",
      gap: "8px",
      padding: "16px",
      boxSizing: "border-box",
      background: "rgba(255,255,255,.985)",
      border: "1px solid #e5e7eb",
      borderRadius: "12px",
      color: "#0f172a",
      fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif",
      fontSize: "14px",
      lineHeight: "1.6",
      textAlign: "center",
      whiteSpace: "pre-line",
      pointerEvents: "auto",
      userSelect: "none",
      cursor: "default",
      boxShadow: "0 10px 30px rgba(15,23,42,.12)",
    });
    document.documentElement.appendChild(maskEl);
    return maskEl;
  }

  function positionMask() {
    if (!maskEl) return;
    const target = findDetailPanel();
    const rect = target ? target.getBoundingClientRect() : null;
    if (rect && rect.width > 200 && rect.height > 120) {
      maskEl.style.left = `${rect.left}px`;
      maskEl.style.top = `${rect.top}px`;
      maskEl.style.width = `${rect.width}px`;
      maskEl.style.height = `${rect.height}px`;
    } else {
      maskEl.style.left = `${Math.round(window.innerWidth * 0.42)}px`;
      maskEl.style.top = "84px";
      maskEl.style.width = `${Math.round(window.innerWidth * 0.56)}px`;
      maskEl.style.height = `${Math.max(220, window.innerHeight - 140)}px`;
    }
  }

  function showMask(text, options = {}) {
    const el = ensureMask();
    el.replaceChildren();
    const textEl = document.createElement("div");
    textEl.textContent = text;
    textEl.style.maxWidth = "560px";
    el.appendChild(textEl);

    if (options.revealLabel && typeof options.onReveal === "function") {
      const button = document.createElement("button");
      button.textContent = options.revealLabel;
      Object.assign(button.style, {
        marginTop: "12px",
        padding: "6px 12px",
        border: "1px solid #d1d5db",
        borderRadius: "8px",
        background: "#fff",
        color: "#374151",
        font: "inherit",
        fontSize: "12px",
        cursor: "pointer",
      });
      button.addEventListener("click", options.onReveal);
      el.appendChild(button);
    }

    positionMask();
    if (!maskTimer) maskTimer = setInterval(positionMask, 800);
  }

  function hideMask() {
    if (maskTimer) {
      clearInterval(maskTimer);
      maskTimer = null;
    }
    if (maskEl) maskEl.remove();
    maskEl = null;
    state.guardKey = null;
  }

  // ---------------------------------------------------------------------
  // Annotation
  // ---------------------------------------------------------------------
  function removeBadge(item) {
    [...item.children].forEach((child) => {
      if (child.classList && child.classList.contains("cg-badge")) child.remove();
    });
  }

  function clearMaskClasses(item) {
    item.classList.remove("cg-masked-item");
    item.removeAttribute("data-cg-label");
    item.querySelectorAll(".cg-masked").forEach((el) => {
      el.classList.remove("cg-masked");
      el.removeAttribute("data-cg-label");
    });
  }

  function clearAnnotation(item) {
    removeBadge(item);
    clearMaskClasses(item);
    item.removeAttribute("data-cg-category");
    item.removeAttribute("data-cg-full");
  }

  function annotate(item, result) {
    if (!item || !result) return;
    const category = result.category || "normal";
    const label = result.action || result.label || "已标注";
    const source = String(result.source || "");
    const isFull = source !== "rules-preview" && !source.includes("preview");

    clearAnnotation(item);
    item.dataset.cgCategory = category;
    if (isFull) {
      item.dataset.cgFull = "1";
      state.fullCache.set(getKey(item), {
        result,
        previewHash: CG.hash(getPreviewText(item)),
      });
      if (state.fullCache.size > 500) {
        const oldest = state.fullCache.keys().next().value;
        if (oldest) state.fullCache.delete(oldest);
      }
    }
    if (category === "normal") return;

    if (getComputedStyle(item).position === "static") {
      item.style.position = "relative";
    }

    const badge = document.createElement("span");
    badge.className = `cg-badge cg-${category}`;
    badge.textContent = label;
    badge.title = [result.reason, result.confidence ? `置信度 ${Math.round(result.confidence * 100)}%` : ""]
      .filter(Boolean)
      .join(" · ");
    item.appendChild(badge);

    const hide = Boolean(result.hide_preview) && (!config || config.hideFlaggedPreviews !== false);
    if (!hide) return;

    const maskLabel = `${label.split("，")[0]} · 预览已隐藏`;
    const preview = getPreviewEl(item);
    if (preview && preview !== item) {
      preview.classList.add("cg-masked");
      preview.setAttribute("data-cg-label", maskLabel);
    } else {
      item.classList.add("cg-masked-item");
      item.setAttribute("data-cg-label", maskLabel);
    }
  }

  // ---------------------------------------------------------------------
  // Active conversation guard: if the page already has a flagged chat open,
  // cover the detail pane before the creator sees it.
  // ---------------------------------------------------------------------
  function guardActiveConversation() {
    if (state.running) return;
    const active = findItems().find(isItemActive);
    if (!active) {
      if (state.guardKey) hideMask();
      return;
    }

    const key = getKey(active);
    if (state.revealedKeys.has(key)) {
      if (state.guardKey === key) hideMask();
      return;
    }

    const preview = getPreviewText(active);
    const previewResult = state.previewCache.get(`${key}:${CG.hash(preview)}`);
    const fullEntry = state.fullCache.get(key);
    const fullResult = fullEntry && fullEntry.result;
    const result =
      previewResult && previewResult.hide_preview ? previewResult : fullResult || previewResult;
    if (!result || !result.hide_preview) {
      if (state.guardKey) hideMask();
      return;
    }
    if (state.guardKey === key) return;

    state.guardKey = key;
    showMask(`该会话已被标记为「${result.action}」。\n为避免你看到伤害性内容，聊天区已遮住。`, {
      revealLabel: "仍要查看原文",
      onReveal: () => {
        state.revealedKeys.add(key);
        hideMask();
      },
    });
  }

  // ---------------------------------------------------------------------
  // Preview pass (no clicking)
  // ---------------------------------------------------------------------
  async function loadCachedAnnotations() {
    try {
      const items = findItems();
      const keys = [...new Set(items.map(getKey))].slice(0, 50);
      if (!keys.length) return;
      const response = await CG.api(
        `/api/dm/annotations?platform=${encodeURIComponent(PLATFORM)}&keys=${encodeURIComponent(keys.join(","))}`
      );
      const annotations = (response && response.annotations) || {};
      for (const item of items) {
        const annotation = annotations[getKey(item)];
        if (annotation) annotate(item, annotation);
      }
    } catch (error) {
      CG.log("loadCachedAnnotations failed", error.message);
    }
  }

  async function scanPreviews() {
    if (state.previewBusy) return;
    state.previewBusy = true;
    try {
      config = await CG.getConfig();
      const items = findItems();
      state.lastItemCount = items.length;
      const pending = [];

      for (const item of items) {
        const preview = getPreviewText(item);
        if (!preview) continue;
        const key = getKey(item);
        const fullEntry = state.fullCache.get(key);
        if (fullEntry && fullEntry.previewHash === CG.hash(preview)) {
          annotate(item, fullEntry.result);
          continue;
        }
        const cacheKey = `${key}:${CG.hash(preview)}`;
        if (state.previewCache.has(cacheKey)) {
          annotate(item, state.previewCache.get(cacheKey));
          continue;
        }
        pending.push({ item, key, preview, cacheKey });
      }

      for (let i = 0; i < pending.length; i += 12) {
        const chunk = pending.slice(i, i + 12);
        const response = await CG.api("/api/dm/preview", "POST", {
          items: chunk.map((x) => ({ id: x.key, preview: x.preview, name: getName(x.item) })),
        });
        for (const result of (response && response.results) || []) {
          const match = chunk.find((x) => x.key === result.id);
          if (!match) continue;
          state.previewCache.set(match.cacheKey, result);
          annotate(match.item, result);
        }
      }

      if (state.previewCache.size > 600) {
        const keys = [...state.previewCache.keys()].slice(0, 200);
        keys.forEach((key) => state.previewCache.delete(key));
      }
    } catch (error) {
      setStatus(`预览分析失败：${error.message}`, "bad");
    } finally {
      state.previewBusy = false;
      guardActiveConversation();
    }
  }

  // ---------------------------------------------------------------------
  // Auto-open pass
  // ---------------------------------------------------------------------
  function todayKey() {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  }

  async function getDailyCount() {
    const stored = await chrome.storage.local.get("dmDaily");
    const record = stored.dmDaily;
    if (!record || record.date !== todayKey()) return 0;
    return Number(record.count) || 0;
  }

  async function bumpDaily() {
    const current = await getDailyCount();
    await chrome.storage.local.set({ dmDaily: { date: todayKey(), count: current + 1 } });
    return current + 1;
  }

  function clickItem(item) {
    try {
      item.scrollIntoView({ block: "nearest" });
    } catch (_) {
      /* ignore */
    }
    item.click();
  }

  function isItemActive(item) {
    if (!item) return false;
    if (item.getAttribute("aria-selected") === "true" || item.getAttribute("aria-current") === "true") {
      return true;
    }
    const cls = `${safeClass(item)} ${safeClass(item.parentElement)}`;
    return /(^|[\s_-])(active|selected|current|checked)([\s_-]|$)/i.test(cls);
  }

  async function openConversation(item) {
    // If this conversation is already open, clicking it again often does not
    // change the DOM. Read it directly instead of waiting for a change.
    if (isItemActive(item) && extractConversationText().length > 0) {
      await CG.sleep(CG.rand(250, 650));
      return true;
    }

    const before = detailSignature();
    clickItem(item);

    let changed = await CG.waitFor(
      () => detailSignature() !== before && extractConversationText().length > 0,
      3200,
      300
    );

    if (!changed && isItemActive(item) && extractConversationText().length > 0) {
      changed = true;
    }

    if (!changed) {
      // Some Vue/React list items ignore .click() and listen on mouse events.
      const rect = item.getBoundingClientRect();
      const options = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: rect.left + Math.min(rect.width / 2, 80),
        clientY: rect.top + Math.min(rect.height / 2, 30),
      };
      item.dispatchEvent(new MouseEvent("mousedown", options));
      item.dispatchEvent(new MouseEvent("mouseup", options));
      item.dispatchEvent(new MouseEvent("click", options));
      changed = await CG.waitFor(
        () => detailSignature() !== before && extractConversationText().length > 0,
        6500,
        300
      );
      if (!changed && isItemActive(item) && extractConversationText().length > 0) {
        changed = true;
      }
    }
    return changed;
  }

  async function processItem(item) {
    const key = getKey(item);
    const name = getName(item) || "未命名会话";
    const preview = getPreviewText(item);

    const previewResult = state.previewCache.get(`${key}:${CG.hash(preview)}`);
    const fullEntry = state.fullCache.get(key);
    const fullResult = fullEntry && fullEntry.result;
    const knownResult =
      previewResult && ["illegal", "malicious"].includes(previewResult.category)
        ? previewResult
        : fullResult || previewResult;
    if (config && config.skipOpenFlagged && knownResult && ["illegal", "malicious"].includes(knownResult.category)) {
      annotate(item, knownResult);
      setStatus(`已拦截高风险私信，未展开：${name}`, "warn");
      return { ok: false, skipped: true, result: knownResult };
    }

    setStatus(`正在读取「${name}」…`, "warn");
    showMask(`Agent 正在读取「${name}」的私信…\n不会发送、拉黑或举报`);

    const opened = await openConversation(item);
    if (!opened) {
      hideMask();
      setStatus(`「${name}」没有打开，已跳过`, "warn");
      return { ok: false, skipped: false };
    }

    await CG.sleep(CG.rand(500, 1100));
    const text = extractConversationText();
    if (!text) {
      hideMask();
      setStatus(`「${name}」没有读到文字，已跳过`, "warn");
      return { ok: false, skipped: false };
    }

    showMask(`Agent 正在判断「${name}」的内容…`);
    let result;
    try {
      result = await CG.api("/api/dm/classify", "POST", {
        platform: PLATFORM,
        conversation_key: key,
        conversation_name: name,
        preview,
        text,
      });
    } catch (error) {
      hideMask();
      setStatus(`分类失败：${error.message}`, "bad");
      return { ok: false, skipped: false };
    }

    const current = findItemByKey(key) || item;
    annotate(current, result);
    state.sessionCount += 1;

    if (result.hide_preview) {
      showMask(`已标注：${result.action}\n${result.reason || ""}\n\n预览已隐藏，下一会话继续…`);
    } else {
      hideMask();
    }

    setStatus(`已分析：${name} · ${result.action}`, result.hide_preview ? "bad" : "");
    await CG.sleep(CG.humanReadingDelay(text.length));
    return { ok: true, skipped: false, result };
  }

  async function loop() {
    if (state.running) return;
    state.running = true;
    try {
      config = await CG.getConfig();
      if (!config.autoOpenDm) {
        setStatus("自动展开已关闭（只做预览标注）");
        return;
      }
      if (!CG.isActiveHours(config)) {
        setStatus("不在设定的活跃时段，暂停自动展开", "warn");
        return;
      }
      if (!CG.pageVisible()) {
        setStatus("页面不可见，暂停自动展开", "warn");
        return;
      }

      const daily = await getDailyCount();
      if (daily >= config.dailyDmCap) {
        setStatus(`今日已达上限 ${config.dailyDmCap} 条，明天再继续`, "warn");
        return;
      }

      let processedThisRun = 0;
      for (let i = 0; i < config.maxDmPerSession; i += 1) {
        if (state.paused) {
          setStatus("已暂停", "warn");
          break;
        }
        if (!CG.pageVisible()) {
          setStatus("页面不可见，暂停", "warn");
          break;
        }
        if (!CG.isActiveHours(config)) {
          setStatus("已到休息时段，暂停", "warn");
          break;
        }
        if ((await getDailyCount()) >= config.dailyDmCap) {
          setStatus(`今日已达上限 ${config.dailyDmCap} 条`, "warn");
          break;
        }

        const unread = findItems().filter(isUnread);
        const next = unread.find((el) => !wasProcessed(getKey(el)));
        if (!next) {
          setStatus("没有新的未读私信");
          break;
        }

        const key = getKey(next);
        state.processed.set(key, Date.now());
        const outcome = await processItem(next);
        processedThisRun += 1;

        if (outcome.ok) {
          await bumpDaily();
        }
        updatePanel();

        if (processedThisRun % 10 === 0) {
          setStatus("已连续处理 10 条，按安全节奏休息 3 分钟…", "warn");
          hideMask();
          await CG.sleep(CG.rand(150000, 240000));
        } else {
          await CG.sleep(CG.betweenItemsDelay());
        }
      }

      setStatus(`本轮结束，共处理 ${processedThisRun} 条`);
    } catch (error) {
      CG.log("DM loop failed", error.message);
      setStatus(`自动扫描出错：${error.message}`, "bad");
    } finally {
      state.running = false;
      hideMask();
      loadCachedAnnotations();
      scanPreviews();
      updatePanel();
    }
  }

  // ---------------------------------------------------------------------
  // Panel
  // ---------------------------------------------------------------------
  function setStatus(text, tone = "") {
    state.lastStatus = text;
    if (!panel) return;
    panel.setStatus(text, tone);
    updatePanel();
  }

  async function updatePanel() {
    if (!panel) return;
    const daily = await getDailyCount();
    const countEl = panel.shadow.querySelector("[data-cg-count]");
    if (countEl) {
      countEl.textContent = `今日 ${daily}/${config ? config.dailyDmCap : 60} · 识别 ${state.lastItemCount} · 已处理 ${state.sessionCount}`;
    }
    const pauseBtn = panel.shadow.querySelector('[data-act="pause"]');
    if (pauseBtn) pauseBtn.textContent = state.paused ? "继续" : "暂停";
  }

  function createPanel() {
    panel = CG.createPanel({ id: "cg-dm-panel", title: "私信守护 · 本地分析" });
    panel.body.innerHTML = `
      <div class="row"><span class="status" data-cg-status>启动中…</span><span class="small" data-cg-count></span></div>
      <div class="btns">
        <button class="primary" data-act="scan">立即扫描未读</button>
        <button data-act="pause">暂停</button>
        <button data-act="refresh">刷新标注</button>
      </div>
      <div class="small">只在本机分析；不自动回复、不拉黑、不举报。高风险私信会遮住预览。</div>`;
    panel.onAction(async (action) => {
      if (action === "scan") {
        state.paused = false;
        await loop();
      } else if (action === "pause") {
        state.paused = !state.paused;
        setStatus(state.paused ? "已暂停" : "继续运行", state.paused ? "warn" : "");
        updatePanel();
        if (!state.paused) loop();
      } else if (action === "refresh") {
        setStatus("刷新标注中…", "warn");
        await loadCachedAnnotations();
        await scanPreviews();
        setStatus("标注已刷新");
      }
    });
    panel.setFooter("本地分析 · 文本不上传云端 · 只标注，不自动回复");
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  async function init() {
    config = await CG.getConfig();
    if (!config.autoOpenDm) {
      // Still useful: preview labels appear without opening anything.
      CG.log("autoOpenDm is off; preview-only mode");
    }
    createPanel();
    updatePanel();
    setStatus("正在读取会话列表…");

    await CG.sleep(2200);
    await loadCachedAnnotations();
    await scanPreviews();
    setStatus("预览标注已就绪");

    setInterval(() => {
      scanPreviews();
    }, 7000);

    setInterval(() => {
      if (!state.running && !state.paused) loop();
    }, 25000);

    document.addEventListener("visibilitychange", () => {
      if (CG.pageVisible()) {
        scanPreviews();
        if (!state.paused) loop();
      }
    });

    document.addEventListener(
      "click",
      (event) => {
        const item = event.target && event.target.closest
          ? event.target.closest('[data-cg-item="1"]')
          : null;
        if (!item) return;
        setTimeout(() => {
          if (!state.running) guardActiveConversation();
        }, 700);
      },
      true
    );

    window.addEventListener("beforeunload", hideMask);

    if (config.autoOpenDm && CG.isActiveHours(config)) {
      await CG.sleep(3500);
      loop();
    }
  }

  init().catch((error) => {
    CG.log("DM init failed", error.message);
    setStatus(`初始化失败：${error.message}`, "bad");
  });
})();
