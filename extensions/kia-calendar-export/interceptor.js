// Runs in the page's own JS world (world: "MAIN") at document_start.
//
// Why: scraping a calendar out of the DOM is brittle — class names change and
// the grid usually hides most of the session detail behind a click. The
// calendar itself already asks the server for clean JSON. So we listen to that
// instead: patch fetch/XHR, and forward any JSON response to the extension's
// content script via window.postMessage. Nothing is sent anywhere else.

(() => {
  const TAG = "KTX_NET";
  const MAX_BODY = 4 * 1024 * 1024; // ignore anything absurdly large

  function looksLikeJson(text, contentType) {
    if (contentType && contentType.includes("json")) return true;
    if (!text) return false;
    const head = text.slice(0, 2048).trimStart();
    return head.startsWith("{") || head.startsWith("[");
  }

  function forward(url, text, contentType) {
    try {
      if (!text || text.length > MAX_BODY) return;
      if (!looksLikeJson(text, contentType)) return;
      const data = JSON.parse(text);
      window.postMessage({ __ktx: TAG, url: String(url || ""), data }, "*");
    } catch (_) {
      // not JSON, or not parseable — nothing to do
    }
  }

  // --- fetch -----------------------------------------------------------
  const nativeFetch = window.fetch;
  if (typeof nativeFetch === "function") {
    window.fetch = function (...args) {
      return nativeFetch.apply(this, args).then((res) => {
        try {
          const url = res.url || (typeof args[0] === "string" ? args[0] : args[0] && args[0].url);
          res
            .clone()
            .text()
            .then((t) => forward(url, t, res.headers && res.headers.get("content-type")))
            .catch(() => {});
        } catch (_) {}
        return res;
      });
    };
  }

  // --- XMLHttpRequest --------------------------------------------------
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__ktxUrl = url;
    return open.call(this, method, url, ...rest);
  };

  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", () => {
      try {
        if (this.responseType && this.responseType !== "text" && this.responseType !== "json") return;
        const text =
          this.responseType === "json" ? JSON.stringify(this.response) : this.responseText;
        forward(this.__ktxUrl, text, this.getResponseHeader("content-type"));
      } catch (_) {}
    });
    return send.apply(this, args);
  };

  // --- server-rendered payloads ---------------------------------------
  // Some apps ship the first page of calendar data inline (__NEXT_DATA__,
  // window.__INITIAL_STATE__, a <script type="application/json"> blob).
  // Sweep those once the DOM is parsed.
  function sweepInline() {
    document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"]').forEach((s) => {
      forward(location.href + "#inline", s.textContent, "application/json");
    });
    ["__NEXT_DATA__", "__INITIAL_STATE__", "__NUXT__", "__APP_STATE__"].forEach((key) => {
      try {
        if (window[key]) {
          window.postMessage(
            { __ktx: TAG, url: location.href + "#" + key, data: JSON.parse(JSON.stringify(window[key])) },
            "*"
          );
        }
      } catch (_) {}
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", sweepInline, { once: true });
  } else {
    sweepInline();
  }
})();
