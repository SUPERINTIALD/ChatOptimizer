(() => {
  if (location.hostname !== "chatgpt.com") return;
  if (window.__llmLiteFetchHookInstalled) return;
  window.__llmLiteFetchHookInstalled = true;

  const DEFAULTS = {
    enabled: true,
    mode: "smart",
    keepLastTurns: 12,
    loadOlderBatch: 10,
    backfillTurns: 0,
    debugLogs: true,
    showLoadOlderButton: true,
    autoLoadOlderOnScroll: true,
    autoReloadAfterApply: true
  };

  let config = { ...DEFAULTS };

  function normalizeConfig(values) {
    return {
      ...DEFAULTS,
      ...values,
      mode: ["safe", "smart", "aggressive", "ultra", "custom"].includes(values?.mode) ? values.mode : DEFAULTS.mode,
      keepLastTurns: Math.max(2, Math.min(200, Number(values?.keepLastTurns) || DEFAULTS.keepLastTurns)),
      loadOlderBatch: Math.max(1, Math.min(200, Number(values?.loadOlderBatch) || DEFAULTS.loadOlderBatch)),
      backfillTurns: Math.max(0, Number(values?.backfillTurns) || 0),
      enabled: Boolean(values?.enabled),
      debugLogs: Boolean(values?.debugLogs),
      showLoadOlderButton: Boolean(values?.showLoadOlderButton),
      autoLoadOlderOnScroll: Boolean(values?.autoLoadOlderOnScroll),
      autoReloadAfterApply: Boolean(values?.autoReloadAfterApply)
    };
  }

  try {
    const bootstrap = document.currentScript?.dataset?.config;
    if (bootstrap) {
      config = normalizeConfig(JSON.parse(bootstrap));
    }
  } catch (error) {
    console.warn("[LLM Lite] Failed to parse bootstrap config:", error);
  }

  window.addEventListener("message", event => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "llm-lite-extension" || data.type !== "LLM_LITE_CONFIG") return;
    config = normalizeConfig({ ...config, ...data.payload });
    if (config.debugLogs) {
      console.log("[LLM Lite] Updated config", { ...config });
    }
  });

  function getEffectiveKeepTurns() {
    return Math.max(2, config.keepLastTurns + config.backfillTurns);
  }

  function logSummary(meta) {
    if (!config.debugLogs) return;

    const mode = meta.trimmed ? "trimmed" : "pass-through";
    console.groupCollapsed(
      `%c[LLM Lite] ${mode} %c${meta.renderedMessagesAfter}/${meta.renderedMessagesBefore} rendered messages %c(${meta.mappingAfter}/${meta.mappingBefore} mapping nodes)`,
      "color:#7aa2ff;font-weight:700;",
      "color:#58d68d;font-weight:700;",
      "color:#b3b8c3;"
    );
    console.log("reason:", meta.reason);
    console.log("url:", meta.url);
    console.log("mode:", meta.mode);
    console.log("keepLastTurns:", meta.keepLastTurns);
    console.log("backfillTurns:", meta.backfillTurns);
    console.log("effectiveKeepTurns:", meta.effectiveKeepTurns);
    console.log("currentNode:", meta.currentNode);
    console.log("rootNode:", meta.rootNode);
    console.log("mapping nodes before/after:", meta.mappingBefore, meta.mappingAfter);
    console.log("rendered messages before/after:", meta.renderedMessagesBefore, meta.renderedMessagesAfter);
    console.log("kept node ids:", meta.keptIds);
    console.log("trimmed node ids sample:", meta.trimmedIdsSample);
    console.groupEnd();
  }

  function shouldIntercept(input, init) {
    const url = typeof input === "string" ? input : input?.url || "";
    const method = String(init?.method || input?.method || "GET").toUpperCase();
    return method === "GET" && /\/backend-api\/conversation\//.test(url);
  }

  function countRenderableMessages(mapping) {
    return Object.values(mapping || {}).filter(node => node?.message && node.message.author?.role !== "system").length;
  }

  function getCurrentNodeId(payload, mapping) {
    if (payload?.current_node && mapping[payload.current_node]) return payload.current_node;

    let latestId = null;
    let latestTime = -Infinity;
    for (const [id, node] of Object.entries(mapping)) {
      const createTime = Number(node?.message?.create_time || node?.create_time || -Infinity);
      if (createTime > latestTime) {
        latestTime = createTime;
        latestId = id;
      }
    }
    return latestId;
  }

  function buildChainToRoot(mapping, currentNodeId) {
    const chain = [];
    const seen = new Set();
    let nodeId = currentNodeId;

    while (nodeId && mapping[nodeId] && !seen.has(nodeId)) {
      seen.add(nodeId);
      chain.push(nodeId);
      nodeId = mapping[nodeId]?.parent || null;
    }

    return chain.reverse();
  }

  function pickFirstKeptIndex(chainIds, mapping, keepTurns) {
    let messageCount = 0;
    for (let i = chainIds.length - 1; i >= 0; i -= 1) {
      const node = mapping[chainIds[i]];
      if (node?.message && node.message.author?.role !== "system") {
        messageCount += 1;
        if (messageCount >= keepTurns) {
          return i;
        }
      }
    }
    return Math.max(1, 0);
  }

  function trimPayload(payload) {
    const effectiveKeepTurns = getEffectiveKeepTurns();

    if (!payload || typeof payload !== "object") {
      return {
        payload,
        meta: {
          trimmed: false,
          reason: "payload not object",
          mappingBefore: 0,
          mappingAfter: 0,
          renderedMessagesBefore: 0,
          renderedMessagesAfter: 0,
          keptIds: [],
          trimmedIdsSample: [],
          currentNode: null,
          rootNode: null,
          keepLastTurns: config.keepLastTurns,
          backfillTurns: config.backfillTurns,
          effectiveKeepTurns,
          mode: config.mode,
          url: ""
        }
      };
    }

    const mapping = payload.mapping;
    if (!mapping || typeof mapping !== "object") {
      return {
        payload,
        meta: {
          trimmed: false,
          reason: "no mapping tree",
          mappingBefore: 0,
          mappingAfter: 0,
          renderedMessagesBefore: 0,
          renderedMessagesAfter: 0,
          keptIds: [],
          trimmedIdsSample: [],
          currentNode: null,
          rootNode: null,
          keepLastTurns: config.keepLastTurns,
          backfillTurns: config.backfillTurns,
          effectiveKeepTurns,
          mode: config.mode,
          url: ""
        }
      };
    }

    const mappingBefore = Object.keys(mapping).length;
    const renderedMessagesBefore = countRenderableMessages(mapping);
    const currentNodeId = getCurrentNodeId(payload, mapping);

    if (!currentNodeId || !mapping[currentNodeId]) {
      return {
        payload,
        meta: {
          trimmed: false,
          reason: "current node missing",
          mappingBefore,
          mappingAfter: mappingBefore,
          renderedMessagesBefore,
          renderedMessagesAfter: renderedMessagesBefore,
          keptIds: [],
          trimmedIdsSample: [],
          currentNode: currentNodeId,
          rootNode: null,
          keepLastTurns: config.keepLastTurns,
          backfillTurns: config.backfillTurns,
          effectiveKeepTurns,
          mode: config.mode,
          url: ""
        }
      };
    }

    const chainIds = buildChainToRoot(mapping, currentNodeId);
    if (chainIds.length <= effectiveKeepTurns + 1) {
      return {
        payload,
        meta: {
          trimmed: false,
          reason: "chain already small",
          mappingBefore,
          mappingAfter: mappingBefore,
          renderedMessagesBefore,
          renderedMessagesAfter: renderedMessagesBefore,
          keptIds: chainIds,
          trimmedIdsSample: [],
          currentNode: currentNodeId,
          rootNode: chainIds[0] || null,
          keepLastTurns: config.keepLastTurns,
          backfillTurns: config.backfillTurns,
          effectiveKeepTurns,
          mode: config.mode,
          url: ""
        }
      };
    }

    const rootId = chainIds[0];
    const firstKeptIndex = pickFirstKeptIndex(chainIds, mapping, effectiveKeepTurns);
    const suffixIds = chainIds.slice(firstKeptIndex);
    const firstKeptId = suffixIds[0] || currentNodeId;
    const keptIds = new Set([rootId, ...suffixIds]);

    const newMapping = {};
    for (const id of keptIds) {
      const original = mapping[id];
      if (!original) continue;
      newMapping[id] = {
        ...original,
        children: Array.isArray(original.children)
          ? original.children.filter(childId => keptIds.has(childId))
          : []
      };
    }

    if (newMapping[rootId]) {
      newMapping[rootId] = {
        ...newMapping[rootId],
        parent: null,
        children: firstKeptId === rootId ? newMapping[rootId].children : [firstKeptId]
      };
    }

    if (firstKeptId !== rootId && newMapping[firstKeptId]) {
      newMapping[firstKeptId] = {
        ...newMapping[firstKeptId],
        parent: rootId
      };
    }

    const trimmedPayload = {
      ...payload,
      mapping: newMapping,
      current_node: keptIds.has(currentNodeId) ? currentNodeId : firstKeptId
    };

    const allIds = Object.keys(mapping);
    const trimmedIdsSample = allIds.filter(id => !keptIds.has(id)).slice(0, 25);

    return {
      payload: trimmedPayload,
      meta: {
        trimmed: Object.keys(newMapping).length < mappingBefore,
        reason: Object.keys(newMapping).length < mappingBefore ? "trimmed recent suffix" : "no reduction after trim attempt",
        mappingBefore,
        mappingAfter: Object.keys(newMapping).length,
        renderedMessagesBefore,
        renderedMessagesAfter: countRenderableMessages(newMapping),
        keptIds: [...keptIds],
        trimmedIdsSample,
        currentNode: currentNodeId,
        rootNode: rootId,
        keepLastTurns: config.keepLastTurns,
        backfillTurns: config.backfillTurns,
        effectiveKeepTurns,
        mode: config.mode,
        url: ""
      }
    };
  }

  const originalFetch = window.fetch.bind(window);

  window.fetch = async function llmLiteFetch(input, init) {
    const url = typeof input === "string" ? input : input?.url || "";

    if (!config.enabled || !shouldIntercept(input, init)) {
      return originalFetch(input, init);
    }

    const response = await originalFetch(input, init);

    try {
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        return response;
      }

      const text = await response.clone().text();
      const parsed = JSON.parse(text);
      const result = trimPayload(parsed);
      result.meta.url = url;
      logSummary(result.meta);

      if (!result.meta.trimmed) {
        return response;
      }

      const headers = new Headers(response.headers);
      headers.delete("content-length");

      return new Response(JSON.stringify(result.payload), {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    } catch (error) {
      if (config.debugLogs) {
        console.warn("[LLM Lite] Intercept failed, passing through original response.", error);
      }
      return response;
    }
  };

  if (config.debugLogs) {
    console.log("[LLM Lite] Fetch hook installed", { ...config });
  }
})();