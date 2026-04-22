(() => {
  if (!["chatgpt.com", "chat.openai.com", "claude.ai", "gemini.google.com", "grok.com", "x.com"].includes(location.hostname)) return;  if (window.__llmLiteBridgeLoaded) return;
  window.__llmLiteBridgeLoaded = true;

  const ext = globalThis.chrome;
  function isExtensionAlive() {
    try {
      return !!(ext && ext.runtime && ext.runtime.id);
    } catch {
      return false;
    }
  }
  const DEFAULTS = {
    enabled: true,
    mode: "smart",
    keepLastTurns: 12,
    loadOlderBatch: 10,
    debugLogs: true,
    showLoadOlderButton: true,
    autoLoadOlderOnScroll: true,
    autoReloadAfterApply: true
  };

  const BACKFILL_PREFIX = "llmLiteBackfill:";
  const state = {
    config: { ...DEFAULTS, backfillTurns: 0 },
    injected: false,
    seenScrollDown: false,
    autoLoadLock: false,
    lastPath: location.pathname,
    reloadCooldownUntil: Number(sessionStorage.getItem("llmLiteReloadCooldownUntil") || 0)
  };

  function getThreadKey() {
    const host = location.hostname;
    const path = location.pathname || "/";
    const search = location.search || "";

    if (host === "chatgpt.com" || host === "chat.openai.com") {
      return path.startsWith("/c/") ? `${host}${path}` : null;
    }

    if (host === "claude.ai") {
      return path.startsWith("/chat/") ? `${host}${path}${search}` : null;
    }

    if (host === "gemini.google.com") {
      return `${host}${path}${search}`;
    }

    return null;
  }

  function getBackfillStorageKey() {
    const threadKey = getThreadKey();
    return threadKey ? `${BACKFILL_PREFIX}${threadKey}` : null;
  }

  function normalizeSyncConfig(values) {
    return {
      enabled: Boolean(values.enabled),
      mode: ["safe", "smart", "aggressive", "ultra", "custom"].includes(values.mode) ? values.mode : DEFAULTS.mode,
      keepLastTurns: Math.max(2, Math.min(200, Number(values.keepLastTurns) || DEFAULTS.keepLastTurns)),
      loadOlderBatch: Math.max(1, Math.min(200, Number(values.loadOlderBatch) || DEFAULTS.loadOlderBatch)),
      debugLogs: Boolean(values.debugLogs),
      showLoadOlderButton: Boolean(values.showLoadOlderButton),
      autoLoadOlderOnScroll: Boolean(values.autoLoadOlderOnScroll),
      autoReloadAfterApply: Boolean(values.autoReloadAfterApply)
    };
  }

  function buildConfig(syncValues, localValues = {}) {
    const normalized = normalizeSyncConfig(syncValues);
    const backfillKey = getBackfillStorageKey();
    const backfillTurns = backfillKey
      ? Math.max(0, Number(localValues[backfillKey]) || 0)
      : 0;

    return {
      ...normalized,
      backfillTurns
    };
  }

  function injectMainWorldScript(initialConfig) {
    const script = document.createElement("script");
    script.src = ext.runtime.getURL("inject.js");
    script.async = false;
    script.dataset.config = JSON.stringify(initialConfig);
    (document.documentElement || document.head || document.body).appendChild(script);
    script.remove();
  }

  function postConfig(config) {
    window.postMessage({
      source: "llm-lite-extension",
      type: "LLM_LITE_CONFIG",
      payload: config
    }, "*");
  }

  function loadCombinedConfig(callback) {
  if (!isExtensionAlive()) return;

  try {
    ext.storage.sync.get(DEFAULTS, syncValues => {
      const backfillKey = getBackfillStorageKey();

      if (!backfillKey) {
        callback(buildConfig(syncValues, {}));
        return;
      }

      ext.storage.local.get({ [backfillKey]: 0 }, localValues => {
        callback(buildConfig(syncValues, localValues));
      });
    });
  } catch (error) {
    console.warn("[LLM Lite] loadCombinedConfig skipped: extension context invalidated", error);
  }
  }

  function refreshBridge() {
    if (!isExtensionAlive()) return;
    // loadCombinedConfig(config => {
    //   state.config = config;

    //   if (!state.injected) {
    //     injectMainWorldScript(config);
    //     state.injected = true;
    //   }

    //   setTimeout(() => postConfig(config), 0);
    //   renderFloatingControls();
    // });

      if (!state.injected) {
        injectMainWorldScript(state.config);
        state.injected = true;
        setTimeout(() => postConfig(state.config), 0);
      }

      loadCombinedConfig(config => {
        state.config = config;
        setTimeout(() => postConfig(config), 0);
        renderFloatingControls();
      });
  }

  function setBackfillTurns(nextValue) {
    if (state.config.debugLogs) {
      console.log("[LLM Lite][content] setBackfillTurns", {
        thread: getThreadKey(),
        nextValue
      });
    }
    if (!isExtensionAlive()) return;
    const backfillKey = getBackfillStorageKey();
    if (!backfillKey) return;

    ext.storage.local.set({ [backfillKey]: Math.max(0, nextValue) }, () => {
      const cooldownUntil = Date.now() + 2500;
      sessionStorage.setItem("llmLiteReloadCooldownUntil", String(cooldownUntil));
      if (state.config.debugLogs) {
        console.log("[LLM Lite][content] reloading page after backfill change", {
          thread: getThreadKey(),
          cooldownUntil
        });
      }
      location.reload();
    });
  }

  function incrementBackfill(delta) {
    const backfillKey = getBackfillStorageKey();
    if (!backfillKey) return;

    ext.storage.local.get({ [backfillKey]: 0 }, values => {
      const current = Math.max(0, Number(values[backfillKey]) || 0);
      const next = current + Math.max(1, delta);
      if (state.config.debugLogs) {
        console.log("[LLM Lite] load older requested", {
          thread: getThreadKey(),
          currentBackfill: current,
          nextBackfill: next,
          batch: delta
        });
      }
      setBackfillTurns(next);
    });
  }

  function resetBackfill() {
    setBackfillTurns(0);
  }

  function getScrollRoot() {
    return document.querySelector("[data-scroll-root]") || document.scrollingElement || document.documentElement;
  }

  function renderFloatingControls() {
    if (!document.body) {
      requestAnimationFrame(renderFloatingControls);
      return;
    }

    const threadKey = getThreadKey();
    let host = document.getElementById("llm-lite-controls");

    if (!state.config.enabled || !state.config.showLoadOlderButton || !threadKey) {
      host?.remove();
      return;
    }

    if (!host) {
      host = document.createElement("div");
      host.id = "llm-lite-controls";
      host.style.position = "fixed";
      host.style.right  = "16px";
      host.style.bottom = "16px";
      host.style.zIndex = "2147483647";
      host.style.display = "flex";
      host.style.gap = "8px";
      host.style.alignItems = "center";
      host.style.padding = "10px";
      host.style.borderRadius = "14px";
      host.style.background = "rgba(17,18,20,0.92)";
      host.style.border = "1px solid rgba(120,140,180,0.35)";
      host.style.backdropFilter = "blur(8px)";
      host.style.boxShadow = "0 8px 26px rgba(0,0,0,0.28)";
      host.style.fontFamily = "Arial, Helvetica, sans-serif";
      host.style.color = "#f5f7fa";
      document.body.appendChild(host);
    }

    const effectiveVisible = state.config.keepLastTurns + state.config.backfillTurns;

    host.innerHTML = `
      <button id="llm-lite-load-older" style="border:1px solid #4c6fff;background:#4c6fff;color:white;border-radius:10px;padding:8px 12px;cursor:pointer;font-weight:600;">
        Load older (+${state.config.loadOlderBatch})
      </button>
      <button id="llm-lite-reset-window" style="border:1px solid #48515f;background:transparent;color:#d9e0ea;border-radius:10px;padding:8px 12px;cursor:pointer;font-weight:600;">
        Reset window
      </button>
      <div style="font-size:12px;line-height:1.25;color:#b7c0cc;">
        Mode: <strong style="color:#fff;">${state.config.mode}</strong><br>
        Visible now: <strong style="color:#fff;">${effectiveVisible}</strong>
      </div>
    `;

    host.querySelector("#llm-lite-load-older")?.addEventListener("click", () => {
      incrementBackfill(state.config.loadOlderBatch);
    });

    host.querySelector("#llm-lite-reset-window")?.addEventListener("click", () => {
      resetBackfill();
    });
  }

  function attachScrollHandler() {
    if (window.__llmLiteScrollHandlerAttached) return;
    window.__llmLiteScrollHandlerAttached = true;

    document.addEventListener("scroll", () => {
      if (!state.config.enabled || !getThreadKey()) return;

      const root = getScrollRoot();
      if (!root) return;
      if (document.readyState !== "complete") return;
      if (Date.now() < state.reloadCooldownUntil) return;


      if (root.scrollTop > 220) {
        state.seenScrollDown = true;
      }

      if (!state.seenScrollDown) return;
      if (state.autoLoadLock) return;
      if (root.scrollTop > 80) return;

      state.autoLoadLock = true;

      if (state.config.debugLogs) {
        console.log("[LLM Lite] auto-load older triggered", {
          batch: state.config.loadOlderBatch,
          thread: getThreadKey()
        });
      }

      incrementBackfill(state.config.loadOlderBatch);

      setTimeout(() => {
        state.autoLoadLock = false;
      }, 1500);
    }, { passive: true, capture: true });
  }

  function watchRouteChanges() {
    setInterval(() => {
      if (location.pathname === state.lastPath) return;
      state.lastPath = location.pathname;
      state.seenScrollDown = false;
      refreshBridge();
    }, 800);
  }

  ext.storage.onChanged.addListener((changes, area) => {
    // if (area !== "sync" && area !== "local") return;
    // // refreshBridge();

    // if (document.visibilityState === "visible") refreshBridge();
    if (isExtensionAlive()) {
      ext.storage.onChanged.addListener((changes, area) => {
      if (!isExtensionAlive()) return;
      if (area !== "sync" && area !== "local") return;

      if (state.config.debugLogs) {
        console.log("[LLM Lite][content] storage changed", {
          area,
          keys: Object.keys(changes || {}),
          visible: document.visibilityState
        });
      }

      if (document.visibilityState === "visible") {
        refreshBridge();
      }
    });
  }
  });

  refreshBridge();
  attachScrollHandler();
  watchRouteChanges();

  document.addEventListener("DOMContentLoaded", renderFloatingControls);
  window.addEventListener("load", renderFloatingControls);
})();