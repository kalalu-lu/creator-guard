/* Creator Guard - comment page core.
 * Works on Bilibili video pages and Xiaohongshu note pages.
 * It reads rendered comments, sends them to the local classifier, and renders
 * a shadow-DOM panel with actionable suggestions first, then category shares.
 */
(() => {
  if (window.__CG_COMMENTS_CORE__) return;
  window.__CG_COMMENTS_CORE__ = true;

  const site = window.CG_SITE;
  if (!site || !window.CG_SELECTORS || !window.CG_SELECTORS[site]) return;
  const S = window.CG_SELECTORS[site].comments;
  const PLATFORM = site;

  const state = {
    seen: new Set(),
    collecting: false,
    scrollRunning: false,
    analyzed: 0,
    hasStats: false,
    paused: false,
    threadId: "",
    threadTitle: "",
    lastUrl: location.href,
    lastStats: null,
  };

  let config = null;
  let panel = null;
  let scrollDebounce = null;

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------
  function qa(root, selectors) {
    const out = [];
    if (!root) return out;
    for (const selector of selectors || []) {
      try {
        root.querySelectorAll(selector).forEach((el) => out.push(el));
      } catch (_) {
        /* skip invalid selector */
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

  function isNoiseEl(el) {
    const cls = safeClass(el);
    return /avatar|nick|name|time|date|like|count|badge|icon|emoji|reply-btn|more/i.test(cls);
  }

  function getThreadId() {
    const url = new URL(location.href);
    if (PLATFORM === "bilibili") {
      const match = url.pathname.match(/(BV[0-9A-Za-z]+)/);
      if (match) return match[1];
    }
    if (PLATFORM === "xiaohongshu") {
      const match = url.pathname.match(/\/(?:explore|discovery\/item)\/([0-9A-Za-z]+)/);
      if (match) return match[1];
    }
    return CG.hash(url.pathname + url.search);
  }

  function getThreadTitle() {
    const heading = document.querySelector("h1");
    let title = heading ? CG.textOf(heading) : document.title;
    title = title.replace(/[-_|].*(哔哩哔哩|小红书).*$/i, "").trim();
    return title.slice(0, 120);
  }

  function findContainer() {
    const candidates = qa(document, S.container)
      .filter(CG.isVisible)
      .filter((el) => !el.closest("#cg-comment-panel"));
    if (!candidates.length) return null;

    const scored = candidates.map((el) => {
      const count = qa(el, S.item).filter(CG.isVisible).length;
      const rect = el.getBoundingClientRect();
      const scrollable = el.scrollHeight > el.clientHeight + 20;
      return { el, count, scrollable, area: rect.width * rect.height };
    });
    scored.sort((a, b) => b.count - a.count || Number(b.scrollable) - Number(a.scrollable) || b.area - a.area);
    const best = scored[0];
    if (!best || best.count === 0) return null;
    // If the comment block itself does not scroll, the page/window does.
    // Returning null makes autoScroll use window.scrollBy.
    return best.scrollable ? best.el : null;
  }

  function findComments() {
    let items;
    if (PLATFORM === "bilibili") {
      items = collectBiliComments();
    } else {
      items = qa(document, S.item);
    }
    if (!items.length) items = qa(document, S.item);
    if (!items.length) return [];

    items = [...new Set(items)].filter((el) => {
      if (!CG.isVisible(el)) return false;
      if (el.closest("#cg-comment-panel")) return false;
      const rect = el.getBoundingClientRect();
      const text = PLATFORM === "bilibili" ? CG.textOf(getContentEl(el)) : CG.textOf(el);
      return rect.height >= 24 && rect.height <= 1600 && text.length >= 2 && text.length <= 1600;
    });

    if (PLATFORM === "bilibili") {
      items = items.filter((el) => !el.classList.contains("sub-reply-item") && !el.closest(".sub-reply-item"));
    }

    // Keep outer comment containers, not their nested layout wrappers.
    items = items.filter(
      (el) => !items.some((other) => other !== el && el.contains(other) && !other.contains(el))
    );
    return items;
  }

  function collectBiliComments() {
    // Bilibili's comment area is a Web Component tree with open shadow roots:
    // bili-comments > bili-comment-thread-renderer > bili-comment-renderer.
    // Normal document.querySelectorAll() cannot see inside those roots.
    const host = document.querySelector("bili-comments");
    if (!host || !host.shadowRoot) return [];

    const out = [];
    const seen = new Set();
    const seenRoots = new Set();
    const visit = (root) => {
      if (!root || !root.querySelectorAll || seenRoots.has(root)) return;
      seenRoots.add(root);
      root.querySelectorAll("bili-comment-renderer, bili-comment-reply-renderer").forEach((el) => {
        if (!seen.has(el)) {
          seen.add(el);
          out.push(el);
        }
      });
      root
        .querySelectorAll(
          "bili-comment-thread-renderer, bili-comment-replies-renderer, bili-comment-renderer, bili-comment-reply-renderer"
        )
        .forEach((el) => {
          if (el.shadowRoot) visit(el.shadowRoot);
        });
    };
    visit(host.shadowRoot);
    return out;
  }

  function getAuthor(item) {
    if (PLATFORM === "bilibili") {
      const userInfo = item.shadowRoot && item.shadowRoot.querySelector("bili-comment-user-info");
      const name = userInfo && userInfo.shadowRoot && userInfo.shadowRoot.querySelector("#user-name");
      const text = CG.textOf(name || userInfo);
      if (text) return text.slice(0, 40);
    }

    for (const selector of S.author) {
      let els = [];
      try {
        els = [...item.querySelectorAll(selector)];
      } catch (_) {
        continue;
      }
      for (const el of els) {
        if (!CG.isVisible(el)) continue;
        const text = CG.textOf(el);
        if (text && text.length <= 40 && !/^\d+$/.test(text)) return text;
      }
    }
    return "";
  }

  function getContentEl(item) {
    if (PLATFORM === "bilibili") {
      const rich = item.shadowRoot && item.shadowRoot.querySelector("bili-rich-text");
      if (rich) {
        const contents = rich.shadowRoot && rich.shadowRoot.querySelector("#contents");
        return contents || rich;
      }
    }

    const candidates = [];
    for (const selector of S.content) {
      let els = [];
      try {
        els = [...item.querySelectorAll(selector)];
      } catch (_) {
        continue;
      }
      for (const el of els) {
        if (!CG.isVisible(el) || isNoiseEl(el)) continue;
        const text = CG.textOf(el);
        if (!text || text.length > 1200) continue;
        // The author is usually a separate sibling; don't take a parent that
        // contains both author and body.
        if (getAuthor(item) && text === getAuthor(item)) continue;
        candidates.push(el);
      }
    }

    if (!candidates.length) return null;
    const scored = candidates.map((el) => {
      const text = CG.textOf(el);
      let score = 0;
      if (el.children.length === 0) score += 25;
      if (text.length > 8) score += 10;
      if (text.length > 30) score += 5;
      if (isNoiseEl(el)) score -= 50;
      return { el, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0] ? scored[0].el : null;
  }

  function getLikes(item) {
    if (PLATFORM === "bilibili") {
      const actions = item.shadowRoot && item.shadowRoot.querySelector("bili-comment-action-buttons-renderer");
      const count = actions && actions.shadowRoot && actions.shadowRoot.querySelector("#like #count, #like");
      const match = CG.textOf(count).match(/(\d+(?:\.\d+)?)(万)?/);
      if (match) {
        return Math.round(Number(match[1]) * (match[2] ? 10000 : 1));
      }
      return 0;
    }

    for (const selector of S.likes) {
      let els = [];
      try {
        els = [...item.querySelectorAll(selector)];
      } catch (_) {
        continue;
      }
      for (const el of els) {
        if (!CG.isVisible(el)) continue;
        const text = CG.textOf(el);
        const match = text.match(/(\d+(?:\.\d+)?)(万)?/);
        if (match) {
          const number = Number(match[1]) * (match[2] ? 10000 : 1);
          if (Number.isFinite(number)) return Math.round(number);
        }
      }
    }
    return 0;
  }

  function getCommentId(item, author, text) {
    // Bilibili's Web Components reuse id="comment" on every main comment.
    // It is not a stable per-comment identifier, so use author + content hash.
    if (PLATFORM === "bilibili") {
      return `bili:${CG.hash(`${author}|${text}`).slice(0, 24)}`;
    }

    for (const attr of ["data-id", "data-comment-id", "data-rpid", "data-cid", "id"]) {
      const value = item.getAttribute(attr);
      if (value && value.length <= 160) return value;
    }
    return CG.hash(`${author}|${text}`).slice(0, 24);
  }

  function extractComment(item) {
    const contentEl = getContentEl(item);
    let text = contentEl ? CG.textOf(contentEl) : CG.textOf(item);
    const author = getAuthor(item);
    if (!contentEl && author && text.startsWith(author)) {
      text = text.slice(author.length).trim();
    }
    text = text.replace(/\s*(回复|点赞|赞)\s*$/, "").trim().slice(0, 800);
    if (!text) return null;
    return {
      id: getCommentId(item, author, text),
      text,
      author,
      likes: getLikes(item),
    };
  }

  function commentFingerprint() {
    return findComments()
      .slice(-6)
      .map((item) => {
        const comment = extractComment(item);
        return comment ? comment.id : "";
      })
      .filter(Boolean)
      .join("|");
  }

  // ---------------------------------------------------------------------
  // Collection
  // ---------------------------------------------------------------------
  function updateProgress(status) {
    if (!panel) return;
    if (status) panel.setStatus(status, "warn");
    const countEl = panel.shadow.querySelector("[data-cg-count]");
    if (countEl) countEl.textContent = `本页 ${findComments().length} 条`;
  }

  async function collectVisible() {
    if (state.collecting) return 0;
    state.collecting = true;
    let added = 0;
    try {
      const items = findComments();
      const batch = [];
      for (const item of items) {
        const comment = extractComment(item);
        if (!comment || state.seen.has(comment.id)) continue;
        batch.push(comment);
        if (batch.length >= 8) break;
      }
      CG.log(`comments: found=${items.length}, new=${batch.length}, seen=${state.seen.size}`);

      if (!batch.length) {
        if (!items.length) {
          updateProgress("当前屏没有识别到评论，请先向下滚动到评论区，等评论加载出来再点");
          CG.log("comments: no comment item found on current screen");
        } else {
          updateProgress("当前屏评论已分析过，继续向下滚动可收集更多");
        }
        return 0;
      }

      updateProgress(`正在分析 ${batch.length} 条评论…`);
      const response = await CG.api("/api/comments/classify", "POST", {
        platform: PLATFORM,
        thread_id: state.threadId,
        thread_title: state.threadTitle,
        comments: batch.map((item) => ({ id: item.id, text: item.text })),
      });

      const results = (response && response.results) || [];
      for (const item of batch) state.seen.add(item.id);
      added = results.length;
      state.analyzed += added;
      if (state.seen.size > 6000) {
        state.seen = new Set([...state.seen].slice(-3000));
      }

      updateProgress(
        response && response.degraded
          ? `已分析 ${state.analyzed} 条（模型不可用，当前为规则兜底）`
          : `已分析 ${state.analyzed} 条`
      );

      // Keep collecting in small batches so the page stays responsive.
      if (added === 8) {
        await CG.sleep(CG.rand(350, 900));
        state.collecting = false;
        return added + (await collectVisible());
      }
      return added;
    } catch (error) {
      updateProgress(`分析失败：${error.message}`);
      return 0;
    } finally {
      state.collecting = false;
    }
  }

  async function autoScroll() {
    if (state.scrollRunning) return;
    state.scrollRunning = true;
    try {
      config = await CG.getConfig();
      if (!config.autoCollectComments) {
        await collectVisible();
        await refreshStats(false);
        return;
      }

      // On Bilibili the comment block is often below the fold. Make one gentle
      // scroll so lazy-loaded comments can appear before we start the loop.
      if (!findComments().length) {
        window.scrollBy({ top: Math.round(window.innerHeight * 0.8), behavior: "smooth" });
        await CG.sleep(1800);
      }
      await CG.waitFor(() => findComments().length > 0, 6000, 500);
      const container = findContainer();
      let lastFingerprint = commentFingerprint();
      let stagnant = 0;

      for (let i = 0; i < config.maxCommentScrolls; i += 1) {
        if (state.paused || !CG.pageVisible()) break;
        await collectVisible();
        const fingerprint = commentFingerprint();
        if (fingerprint === lastFingerprint) stagnant += 1;
        else stagnant = 0;
        if (stagnant >= 3) break;
        lastFingerprint = fingerprint;

        const before = container ? container.scrollTop : window.scrollY;
        if (container) {
          container.scrollBy({ top: Math.max(320, container.clientHeight * 0.85), behavior: "smooth" });
        } else {
          window.scrollBy({ top: Math.max(320, window.innerHeight * 0.85), behavior: "smooth" });
        }
        await CG.sleep(CG.rand(1500, 2900));
        const after = container ? container.scrollTop : window.scrollY;
        if (Math.abs(after - before) < 4) stagnant += 1;
      }

      await collectVisible();
      await refreshStats(false);
    } finally {
      state.scrollRunning = false;
      updateProgress();
    }
  }

  // ---------------------------------------------------------------------
  // Stats panel
  // ---------------------------------------------------------------------
  async function refreshStats(force = false) {
    try {
      const params = new URLSearchParams({
        platform: PLATFORM,
        thread_id: state.threadId,
        force: force ? "true" : "false",
      });
      if (state.threadTitle) params.set("thread_title", state.threadTitle);
      const data = await CG.api(`/api/comments/stats?${params.toString()}`);
      state.lastStats = data;
      state.hasStats = Number(data.total) > 0;
      renderStats(data);
    } catch (error) {
      updateProgress(`统计失败：${error.message}`);
    }
  }

  function makeBarRow(bar) {
    const row = CG.el("div", { className: "bar-row" }, [
      CG.el("span", { textContent: bar.label }),
      CG.el("span", { className: "bar" }, [
        CG.el("i", { style: `width:${Math.max(2, bar.pct)}%` }),
      ]),
      CG.el("span", { textContent: `${bar.pct}%` }),
    ]);
    return row;
  }

  function renderStats(data) {
    if (!panel) return;
    const root = panel.shadow.querySelector("[data-cg-dynamic]");
    if (!root) return;
    root.replaceChildren();

    root.appendChild(
      CG.el("div", {
        className: "headline",
        textContent: data.headline || "还没有收集到评论",
      })
    );

    const summary = data.suggestion_summary || "";
    const suggestions = data.top_suggestions || [];
    if (summary || suggestions.length) {
      root.appendChild(CG.el("div", { className: "section-title", textContent: "有效建议 · 优先看这里" }));
      if (summary) {
        root.appendChild(CG.el("div", { className: "suggestion" }, [
          CG.el("span", { className: "num", textContent: "→" }),
          CG.el("span", { textContent: summary }),
        ]));
      }
      suggestions.slice(0, 3).forEach((text, index) => {
        root.appendChild(CG.el("div", { className: "suggestion" }, [
          CG.el("span", { className: "num", textContent: String(index + 1) }),
          CG.el("span", { textContent: text }),
        ]));
      });
    } else {
      root.appendChild(CG.el("div", { className: "empty", textContent: "还没有提取到具体建议，继续收集评论…" }));
    }

    if (data.bars && data.bars.length) {
      root.appendChild(CG.el("div", { className: "section-title", textContent: `评论构成 · 基于 ${data.total} 条` }));
      data.bars.slice(0, 6).forEach((bar) => root.appendChild(makeBarRow(bar)));
    }

    const categoryEntries = Object.entries(data.category_counts || {});
    if (categoryEntries.length) {
      const chips = CG.el("div", { className: "chips" });
      categoryEntries.forEach(([label, count]) => {
        chips.appendChild(CG.el("span", { className: "chip", textContent: `${label} ${count}` }));
      });
      root.appendChild(chips);
    }

    if (Number(data.new_comments) > 0) {
      root.appendChild(
        CG.el("div", {
          className: "warnbox",
          textContent: `有 ${data.new_comments} 条新评论，将在下一次 5 天统计中计入。`,
        })
      );
    }

    root.appendChild(
      CG.el("div", {
        className: "small",
        textContent: `统计时间 ${CG.formatTime(data.generated_at || data.snapshot_at)} · 每 ${data.window_days || 5} 天更新一次`,
      })
    );
  }

  function createPanel() {
    panel = CG.createPanel({ id: "cg-comment-panel", title: "评论守护 · 本地分析", position: "bottom-right" });
    panel.body.innerHTML = `
      <div class="row"><span class="status" data-cg-status>等待评论加载…</span><span class="small" data-cg-count>本页 0 条</span></div>
      <div data-cg-dynamic></div>
      <div class="btns">
        <button class="primary" data-act="refresh">立即更新统计</button>
        <button data-act="pause">暂停收集</button>
        <button data-act="collect">收集当前屏</button>
      </div>
      <div class="small">有效建议置顶；统计按 5 天窗口生成。只读页面，不回复、不举报。</div>`;
    panel.onAction(async (action) => {
      if (action === "refresh") {
        panel.setStatus("正在重新统计…", "warn");
        await refreshStats(true);
        panel.setStatus("统计已更新");
      } else if (action === "pause") {
        state.paused = !state.paused;
        panel.setStatus(state.paused ? "已暂停收集" : "继续收集", state.paused ? "warn" : "");
        const button = panel.shadow.querySelector('[data-act="pause"]');
        if (button) button.textContent = state.paused ? "继续收集" : "暂停收集";
        if (!state.paused) autoScroll();
      } else if (action === "collect") {
        await collectVisible();
        await refreshStats(false);
      }
    });
    panel.setFooter("每 5 天统计一次 · 数据仅存本机 · 只标注，不自动回复");
  }

  // ---------------------------------------------------------------------
  // Boot / SPA navigation
  // ---------------------------------------------------------------------
  function resetForNewThread() {
    state.seen = new Set();
    state.analyzed = 0;
    state.hasStats = false;
    state.lastStats = null;
    state.paused = false;
    state.scrollRunning = false;
    state.collecting = false;
    state.threadId = getThreadId();
    state.threadTitle = getThreadTitle();
    if (panel) {
      panel.setStatus("检测到新内容，重新收集…", "warn");
      const root = panel.shadow.querySelector("[data-cg-dynamic]");
      if (root) root.replaceChildren();
    }
  }

  async function init() {
    config = await CG.getConfig();
    state.threadId = getThreadId();
    state.threadTitle = getThreadTitle();
    createPanel();
    updateProgress("正在等待评论区加载…");

    await CG.sleep(2600);
    await refreshStats(false);
    await collectVisible();

    if (config.autoCollectComments) {
      autoScroll();
    } else {
      await refreshStats(false);
    }

    setInterval(() => {
      if (CG.pageVisible() && !state.paused && !state.scrollRunning && !state.collecting) collectVisible();
    }, 12000);

    setInterval(() => {
      if (location.href !== state.lastUrl) {
        state.lastUrl = location.href;
        const nextId = getThreadId();
        if (nextId !== state.threadId) {
          resetForNewThread();
          setTimeout(async () => {
            await refreshStats(false);
            await collectVisible();
            if (config.autoCollectComments) autoScroll();
          }, 2200);
        }
      }
    }, 2000);

    document.addEventListener(
      "scroll",
      () => {
        if (scrollDebounce) clearTimeout(scrollDebounce);
        scrollDebounce = setTimeout(() => {
          if (!state.scrollRunning && !state.paused && CG.pageVisible()) collectVisible();
        }, 1800);
      },
      true
    );

    document.addEventListener("visibilitychange", () => {
      if (CG.pageVisible() && !state.scrollRunning && !state.collecting) collectVisible();
    });

    window.addEventListener("beforeunload", () => {
      if (scrollDebounce) clearTimeout(scrollDebounce);
    });
  }

  init().catch((error) => {
    CG.log("Comments init failed", error.message);
    if (panel) panel.setStatus(`初始化失败：${error.message}`, "bad");
  });
})();
