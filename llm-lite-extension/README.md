# LLM Lite Chat Trim Debug

This unpacked extension uses a ChatGPT-specific approach:

- injects a main-world script at `document_start`
- patches `window.fetch`
- intercepts `GET /backend-api/conversation/...`
- trims the conversation mapping to a recent suffix before React renders it
- prints a structured debug summary to the browser console

The full conversation remains on OpenAI's servers. This only lightens what the browser receives and renders.

## Files

```text
llm-lite-extension/
├─ manifest.json
├─ content.js
├─ inject.js
├─ popup.html
├─ popup.css
├─ popup.js
├─ styles.css
└─ README.md
```

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder.
5. Refresh any open ChatGPT tabs.

## Debugging

Open DevTools on ChatGPT and look for logs like:

- `[LLM Lite] Fetch hook installed`
- `[LLM Lite] trimmed 12/1860 rendered messages ...`

## Notes

- This version is intentionally focused on ChatGPT.
- Other platforms would need their own site-specific network hooks.
- If ChatGPT changes the conversation API shape, the trimmer may need adjustments.
