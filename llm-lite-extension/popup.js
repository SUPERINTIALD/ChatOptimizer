const ext = globalThis.chrome;

const MODE_PRESETS = {
  safe: 24,
  smart: 12,
  aggressive: 5,
  ultra: 2,
  custom: null
};

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

const els = {
  enabled: document.getElementById("enabled"),
  mode: document.getElementById("mode"),
  keepLastTurns: document.getElementById("keepLastTurns"),
  loadOlderBatch: document.getElementById("loadOlderBatch"),
  debugLogs: document.getElementById("debugLogs"),
  showLoadOlderButton: document.getElementById("showLoadOlderButton"),
  autoLoadOlderOnScroll: document.getElementById("autoLoadOlderOnScroll"),
  autoReloadAfterApply: document.getElementById("autoReloadAfterApply"),
  applyRestart: document.getElementById("applyRestart"),
  save: document.getElementById("save"),
  reset: document.getElementById("reset"),
  status: document.getElementById("status")
};

function setStatus(message) {
  els.status.textContent = message;
  if (!message) return;
  setTimeout(() => {
    if (els.status.textContent === message) {
      els.status.textContent = "";
    }
  }, 2600);
}

function applyModeUi() {
  const mode = els.mode.value;
  const isCustom = mode === "custom";
  els.keepLastTurns.disabled = !isCustom;

  if (!isCustom && MODE_PRESETS[mode] != null) {
    els.keepLastTurns.value = MODE_PRESETS[mode];
  }
}

function loadForm() {
  ext.storage.sync.get(DEFAULTS, values => {
    els.enabled.checked = Boolean(values.enabled);
    els.mode.value = MODE_PRESETS[values.mode] !== undefined ? values.mode : DEFAULTS.mode;
    els.keepLastTurns.value = Number(values.keepLastTurns || DEFAULTS.keepLastTurns);
    els.loadOlderBatch.value = Number(values.loadOlderBatch || DEFAULTS.loadOlderBatch);
    els.debugLogs.checked = Boolean(values.debugLogs);
    els.showLoadOlderButton.checked = Boolean(values.showLoadOlderButton);
    els.autoLoadOlderOnScroll.checked = Boolean(values.autoLoadOlderOnScroll);
    els.autoReloadAfterApply.checked = Boolean(values.autoReloadAfterApply);
    applyModeUi();
  });
}

function normalizeFormValues() {
  const mode = MODE_PRESETS[els.mode.value] !== undefined ? els.mode.value : DEFAULTS.mode;
  const keepLastTurns = mode === "custom"
    ? Math.max(2, Math.min(200, Number(els.keepLastTurns.value) || DEFAULTS.keepLastTurns))
    : MODE_PRESETS[mode];

  const loadOlderBatch = Math.max(1, Math.min(200, Number(els.loadOlderBatch.value) || DEFAULTS.loadOlderBatch));

  return {
    enabled: els.enabled.checked,
    mode,
    keepLastTurns,
    loadOlderBatch,
    debugLogs: els.debugLogs.checked,
    showLoadOlderButton: els.showLoadOlderButton.checked,
    autoLoadOlderOnScroll: els.autoLoadOlderOnScroll.checked,
    autoReloadAfterApply: els.autoReloadAfterApply.checked
  };
}

function reloadActiveChatGPTTab(doneMessage = "Applied. ChatGPT reloading…") {
  ext.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs.find(t => /^https:\/\/chatgpt\.com\//.test(t.url || ""));
    if (!tab || !tab.id) {
      setStatus("Saved. Open a ChatGPT tab to reload.");
      return;
    }
    ext.tabs.reload(tab.id);
    setStatus(doneMessage);
  });
}

function saveForm({ forceReload = false } = {}) {
  const values = normalizeFormValues();

  ext.storage.sync.set(values, () => {
    els.keepLastTurns.value = values.keepLastTurns;

    if (forceReload || values.autoReloadAfterApply) {
      reloadActiveChatGPTTab();
      return;
    }

    setStatus("Saved.");
  });
}

function resetForm() {
  ext.storage.sync.set(DEFAULTS, () => {
    loadForm();
    setStatus("Reset to defaults.");
  });
}

els.mode.addEventListener("change", applyModeUi);
els.applyRestart.addEventListener("click", () => saveForm({ forceReload: true }));
els.save.addEventListener("click", () => saveForm({ forceReload: false }));
els.reset.addEventListener("click", resetForm);

document.addEventListener("DOMContentLoaded", loadForm);
loadForm();