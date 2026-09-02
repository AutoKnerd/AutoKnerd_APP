// Isolated-world content script.
//
// Receives JSON payloads from interceptor.js, digs calendar-shaped objects out
// of them, normalises those into events, and keeps them in chrome.storage.local
// so the popup can filter and export. Also has a DOM fallback for the case
// where the calendar is server-rendered with no JSON call behind it.

(() => {
  const STORE_KEY = "ktx_events_v1";

  // ---------------------------------------------------------------- fields
  // Key-name heuristics. The calendar's own field names are unknown, so match
  // on intent rather than on an exact schema.
  const RE = {
    start: /^(start|starts|start_?at|start_?date|start_?time|begin|begins|from|date_?from|session_?date|scheduled_?(at|for|start))$/i,
    end: /^(end|ends|end_?at|end_?date|end_?time|finish|finishes|until|to|date_?to|scheduled_?end)$/i,
    title: /^(title|name|subject|summary|label|course|course_?name|session|session_?name|class|class_?name|event_?name|program|programme|module)$/i,
    trainer: /^(trainer|trainers|instructor|instructors|coach|facilitator|presenter|teacher|staff|assigned_?to|owner|host|lead|resource|resource_?name|user_?name|employee)$/i,
    location: /^(location|venue|room|site|address|place|centre|center|facility|dealer|dealership|branch|store)$/i,
    allDay: /^(all_?day|isallday|full_?day)$/i,
    id: /^(id|_id|uuid|guid|event_?id|session_?id|booking_?id|key)$/i,
    notes: /^(notes?|description|details?|comments?|body|info)$/i,
  };

  const firstKey = (obj, re) => Object.keys(obj).find((k) => re.test(k));

  // ------------------------------------------------------------------ dates
  // Returns { ms, floating, dateOnly } or null.
  //  - floating: "YYYYMMDDTHHMMSS" when the source carried no timezone, so the
  //    event is written as local wall-clock time (what a trainer expects).
  //  - dateOnly: "YYYYMMDD" for all-day entries.
  //  - otherwise the source had a real offset/Z and we emit UTC.
  function parseDate(value) {
    if (value == null) return null;

    if (typeof value === "number" || /^\d{10}$|^\d{13}$/.test(String(value).trim())) {
      const n = Number(value);
      if (!isFinite(n) || n <= 0) return null;
      const ms = String(Math.trunc(n)).length <= 10 ? n * 1000 : n;
      if (!isFinite(ms) || Math.abs(ms) > 4102444800000 * 2) return null;
      return { ms, floating: null, dateOnly: false };
    }

    if (typeof value !== "string") return null;
    const s = value.trim();
    if (!s) return null;

    // Date only: 2026-09-14
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const ms = new Date(+m[1], +m[2] - 1, +m[3]).getTime();
      return { ms, floating: m[1] + m[2] + m[3], dateOnly: true };
    }

    // Local wall clock, no zone: 2026-09-14T09:30(:00) or 2026-09-14 09:30:00
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(\.\d+)?$/);
    if (m) {
      const [, y, mo, d, h, mi, se] = m;
      const ms = new Date(+y, +mo - 1, +d, +h, +mi, +(se || 0)).getTime();
      return { ms, floating: `${y}${mo}${d}T${h}${mi}${se || "00"}`, dateOnly: false };
    }

    // Anything with an explicit zone (Z or ±HH:MM), or a format Date understands.
    const ms = Date.parse(s);
    if (isNaN(ms)) return null;
    const zoned = /(Z|[+-]\d{2}:?\d{2})$/.test(s);
    if (zoned) return { ms, floating: null, dateOnly: false };
    // Parseable but zone-less (e.g. "14 Sep 2026 09:30") — treat as local.
    const dt = new Date(ms);
    const p = (n) => String(n).padStart(2, "0");
    return {
      ms,
      floating: `${dt.getFullYear()}${p(dt.getMonth() + 1)}${p(dt.getDate())}T${p(dt.getHours())}${p(
        dt.getMinutes()
      )}${p(dt.getSeconds())}`,
      dateOnly: false,
    };
  }

  function personName(value) {
    if (value == null) return "";
    if (typeof value === "string") return value.trim();
    if (Array.isArray(value)) return value.map(personName).filter(Boolean).join(", ");
    if (typeof value === "object") {
      for (const k of ["name", "fullName", "full_name", "displayName", "display_name", "title", "label", "email"]) {
        if (typeof value[k] === "string" && value[k].trim()) return value[k].trim();
      }
      const first = value.firstName || value.first_name || value.givenName;
      const last = value.lastName || value.last_name || value.familyName || value.surname;
      if (first || last) return [first, last].filter(Boolean).join(" ").trim();
    }
    return "";
  }

  const plain = (value) => {
    if (value == null) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return personName(value);
  };

  // --------------------------------------------------------------- harvest
  // An object is "event shaped" if it has a parseable start date and some text.
  function toEvent(obj, sourceUrl) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;

    const startKey = firstKey(obj, RE.start);
    if (!startKey) return null;
    const start = parseDate(obj[startKey]);
    if (!start) return null;

    const titleKey = firstKey(obj, RE.title);
    const title = titleKey ? plain(obj[titleKey]) : "";
    if (!title) return null; // date + no text is almost always not a session

    const endKey = firstKey(obj, RE.end);
    const end = endKey ? parseDate(obj[endKey]) : null;

    const trainerKey = firstKey(obj, RE.trainer);
    const locationKey = firstKey(obj, RE.location);
    const allDayKey = firstKey(obj, RE.allDay);
    const idKey = firstKey(obj, RE.id);

    // Everything else becomes description lines, so no session detail is lost
    // just because we didn't recognise the field name.
    const used = new Set([startKey, endKey, titleKey, trainerKey, locationKey, allDayKey, idKey].filter(Boolean));
    const detail = {};
    for (const [k, v] of Object.entries(obj)) {
      if (used.has(k)) continue;
      const text = plain(v);
      if (text && text.length <= 500) detail[k] = text;
    }

    const trainer = trainerKey ? personName(obj[trainerKey]) : "";
    const rawId = idKey ? plain(obj[idKey]) : "";

    return {
      id: `ktx-${rawId || `${start.ms}-${title}-${trainer}`}`.replace(/\s+/g, "-").slice(0, 180),
      title,
      trainer,
      location: locationKey ? plain(obj[locationKey]) : "",
      allDay: allDayKey ? Boolean(obj[allDayKey]) : start.dateOnly,
      start,
      end,
      detail,
      source: sourceUrl || "",
    };
  }

  // Walk arbitrary JSON; collect every event-shaped object anywhere in it.
  function harvest(node, sourceUrl, out = [], depth = 0, seen = new WeakSet()) {
    if (depth > 12 || node == null || typeof node !== "object") return out;
    if (seen.has(node)) return out;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) harvest(item, sourceUrl, out, depth + 1, seen);
      return out;
    }

    const event = toEvent(node, sourceUrl);
    if (event) out.push(event);
    // Keep descending either way — a matched object can still contain a nested
    // list of sessions (e.g. a course with occurrences).
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") harvest(value, sourceUrl, out, depth + 1, seen);
    }
    return out;
  }

  // ------------------------------------------------------------ DOM fallback
  // Only used if the network path found nothing. Deliberately generic: pull
  // anything carrying a date attribute or a <time datetime>, plus table rows.
  function harvestDom() {
    const out = [];
    const push = (e) => e && out.push(e);
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

    document
      .querySelectorAll("[data-start], [data-date], [data-event-date], [data-session-date], time[datetime]")
      .forEach((el) => {
        const rawDate =
          el.getAttribute("data-start") ||
          el.getAttribute("data-date") ||
          el.getAttribute("data-event-date") ||
          el.getAttribute("data-session-date") ||
          el.getAttribute("datetime");
        const start = parseDate(rawDate);
        if (!start) return;

        const host = el.closest("[class*=event], [class*=session], li, tr, article") || el;
        const title = clean(host.getAttribute("title") || host.textContent).slice(0, 200);
        if (!title) return;

        const endAttr = el.getAttribute("data-end") || el.getAttribute("data-end-date");
        push({
          id: `ktx-dom-${start.ms}-${title}`.replace(/\s+/g, "-").slice(0, 180),
          title,
          trainer: clean(
            (host.querySelector("[class*=trainer], [class*=instructor], [class*=coach], [data-trainer]") || {})
              .textContent
          ),
          location: clean(
            (host.querySelector("[class*=location], [class*=venue], [class*=room], [data-location]") || {}).textContent
          ),
          allDay: start.dateOnly,
          start,
          end: endAttr ? parseDate(endAttr) : null,
          detail: {},
          source: "dom",
        });
      });

    return out;
  }

  // ----------------------------------------------------------------- store
  let pending = new Map();
  let flushTimer = null;

  function flush() {
    flushTimer = null;
    if (!pending.size) return;
    const batch = pending;
    pending = new Map();
    chrome.storage.local.get(STORE_KEY, (res) => {
      if (chrome.runtime.lastError) return;
      const store = res[STORE_KEY] || {};
      for (const [id, event] of batch) store[id] = event;
      // Bound the store so a long browsing session can't grow it forever.
      const ids = Object.keys(store);
      if (ids.length > 5000) {
        ids
          .sort((a, b) => (store[a].start.ms || 0) - (store[b].start.ms || 0))
          .slice(0, ids.length - 5000)
          .forEach((id) => delete store[id]);
      }
      chrome.storage.local.set({ [STORE_KEY]: store });
    });
  }

  function record(events) {
    let added = 0;
    for (const e of events) {
      if (!pending.has(e.id)) added++;
      pending.set(e.id, e);
    }
    if (added && !flushTimer) flushTimer = setTimeout(flush, 250);
    return added;
  }

  // Kept for the Diagnose button: the shape of recent payloads, not their content.
  const recentPayloads = [];

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.__ktx !== "KTX_NET") return;

    let found = [];
    try {
      found = harvest(msg.data, msg.url);
    } catch (_) {
      return;
    }

    recentPayloads.unshift({
      url: msg.url,
      topLevelKeys: Array.isArray(msg.data) ? ["<array>"] : Object.keys(msg.data || {}).slice(0, 25),
      matched: found.length,
      sampleKeys: found.length ? Object.keys(found[0].detail).slice(0, 20) : [],
    });
    recentPayloads.length = Math.min(recentPayloads.length, 25);

    if (found.length) record(found);
  });

  // -------------------------------------------------------------- messages
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return;

    if (msg.type === "KTX_SCAN") {
      flush();
      const domEvents = harvestDom();
      chrome.storage.local.get(STORE_KEY, (res) => {
        const store = { ...(res[STORE_KEY] || {}) };
        for (const [id, e] of pending) store[id] = e;
        // DOM results only fill gaps left by the network path.
        for (const e of domEvents) if (!store[e.id]) store[e.id] = e;
        sendResponse({ ok: true, events: Object.values(store), domCount: domEvents.length });
      });
      return true; // async
    }

    if (msg.type === "KTX_CLEAR") {
      pending.clear();
      chrome.storage.local.remove(STORE_KEY, () => sendResponse({ ok: true }));
      return true;
    }

    if (msg.type === "KTX_DIAGNOSE") {
      sendResponse({
        ok: true,
        url: location.href,
        payloads: recentPayloads,
        domCandidates: document.querySelectorAll("[data-start], [data-date], time[datetime]").length,
        calendarClasses: [
          ...new Set(
            [...document.querySelectorAll('[class*="calendar"], [class*="event"], [class*="fc-"]')]
              .slice(0, 400)
              .flatMap((el) => [...el.classList])
          ),
        ].slice(0, 120),
      });
      return true;
    }
  });

  // Exposed for the node test harness only; no-op inside Chrome.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { parseDate, toEvent, harvest, personName };
  }
})();
