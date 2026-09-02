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
    trainer: /^(trainers?|instructors?|coach(es)?|facilitators?|presenters?|teachers?|staff|assigned_?to|owner|host|lead|resource|resource_?name|user_?name|employee)$/i,
    // Kia Training filters by facilitator with a checkbox roster, so events very
    // likely carry an id rather than a name; resolved against the roster later.
    trainerId: /^(trainer|instructor|coach|facilitator|presenter|teacher|resource|staff|user|employee)s?_?ids?$/i,
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

  // Pull id-ish values out of a facilitator field: 7, "7", {id:7},
  // [7, 9], [{id:7}] all collapse to ["7"] / ["7","9"].
  function idList(value) {
    if (value == null) return [];
    if (Array.isArray(value)) return value.flatMap(idList);
    if (typeof value === "number") return [String(value)];
    if (typeof value === "string") {
      const s = value.trim();
      // Only treat it as an id if it isn't a human name.
      return s && /^[\w:-]{1,40}$/.test(s) && !/\s/.test(s) ? [s] : [];
    }
    if (typeof value === "object") {
      for (const k of ["id", "_id", "userId", "user_id", "facilitatorId", "facilitator_id", "value"]) {
        if (value[k] != null) return idList(value[k]);
      }
    }
    return [];
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
    const trainerIdKey = firstKey(obj, RE.trainerId);
    const locationKey = firstKey(obj, RE.location);
    const allDayKey = firstKey(obj, RE.allDay);
    const idKey = firstKey(obj, RE.id);

    // Everything else becomes description lines, so no session detail is lost
    // just because we didn't recognise the field name.
    const used = new Set(
      [startKey, endKey, titleKey, trainerKey, trainerIdKey, locationKey, allDayKey, idKey].filter(Boolean)
    );
    const detail = {};
    for (const [k, v] of Object.entries(obj)) {
      if (used.has(k)) continue;
      const text = plain(v);
      if (text && text.length <= 500) detail[k] = text;
    }

    // A facilitator field can hold a name, an object, or just an id. Keep the
    // ids when no name is available — the roster resolves them at scan time.
    const trainer = trainerKey ? personName(obj[trainerKey]) : "";
    const trainerIds = [
      ...(trainer ? [] : idList(trainerKey ? obj[trainerKey] : null)),
      ...idList(trainerIdKey ? obj[trainerIdKey] : null),
    ];
    const rawId = idKey ? plain(obj[idKey]) : "";

    return {
      id: `ktx-${rawId || `${start.ms}-${title}-${trainer}`}`.replace(/\s+/g, "-").slice(0, 180),
      title,
      trainer,
      trainerIds: [...new Set(trainerIds)],
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

  // ------------------------------------------------------- facilitator roster
  // The sidebar lists every facilitator as a checkbox on a coloured chip, and
  // the calendar paints each session block in that person's colour. So there are
  // two independent ways to put a name on a session: the checkbox value (the id
  // the app itself uses, which also resolves ids found in JSON) and the colour.
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const TEXT_TAGS = "div,span,p,label,a,td,th,h1,h2,h3,h4,strong,b,li,button";

  function rgbKey(color) {
    const m = /rgba?\(([^)]+)\)/.exec(color || "");
    if (!m) return "";
    const parts = m[1].split(",").map((n) => parseFloat(n));
    if (parts.length < 3 || parts.some(isNaN)) return "";
    if (parts.length > 3 && parts[3] === 0) return ""; // fully transparent
    return parts.slice(0, 3).map(Math.round).join(",");
  }

  // Nearest ancestor (including self) painted an actual colour.
  function chipColor(el) {
    for (let node = el, i = 0; node && i < 5; node = node.parentElement, i++) {
      const key = rgbKey(getComputedStyle(node).backgroundColor);
      if (key && key !== "255,255,255" && key !== "0,0,0") return key;
    }
    return "";
  }

  function findLabel(pattern) {
    return [...document.querySelectorAll(TEXT_TAGS)].find(
      (el) => !el.children.length && pattern.test(clean(el.textContent))
    );
  }

  function harvestRoster() {
    const byId = new Map();
    const byColor = new Map();
    const names = [];

    // Anchor on the visible section heading, then take the checkboxes after it —
    // more durable than guessing at class names.
    const anchor = findLabel(/filter by facilitator/i);
    const boxes = [...document.querySelectorAll('input[type="checkbox"]')].filter(
      (cb) => !anchor || anchor.compareDocumentPosition(cb) & Node.DOCUMENT_POSITION_FOLLOWING
    );

    for (const cb of boxes) {
      const label = cb.closest("label") || cb.parentElement;
      if (!label) continue;
      const name = clean(label.textContent);
      if (!name || name.length > 60 || !/[a-z]/.test(name)) continue;
      // Roster entries are people on coloured chips; the view toggles ("Show
      // Weekends") and designation filters (IDT, vILT) are neither.
      if (/^(show|filter|clear|all|none)\b/i.test(name)) continue;
      const color = chipColor(label);
      if (!color) continue;

      names.push(name);
      const id = cb.value || cb.getAttribute("data-id") || cb.id || cb.name || "";
      if (id && id !== "on") byId.set(String(id), name);
      if (!byColor.has(color)) byColor.set(color, name);
    }

    return { byId, byColor, names: [...new Set(names)].sort((a, b) => a.localeCompare(b)) };
  }

  // --------------------------------------------------------- DOM calendar read
  const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const MONTH_RE = new RegExp(`^(${MONTHS.join("|")})\\s+(\\d{4})$`, "i");
  const TIME_RE = /^(\d{1,2}):(\d{2})\s*(AM|PM)\b\s*[-–—]?\s*(.*)$/i;

  function visibleMonth() {
    const el = findLabel(MONTH_RE);
    if (!el) return null;
    const m = MONTH_RE.exec(clean(el.textContent));
    return { month: MONTHS.indexOf(m[1].toLowerCase()), year: Number(m[2]) };
  }

  // Bare 1-2 digit leaves inside `el` that aren't part of a session block.
  function dayNumbers(el, chips) {
    const out = [];
    for (const leaf of el.querySelectorAll(TEXT_TAGS)) {
      if (leaf.children.length) continue;
      const text = clean(leaf.textContent);
      if (!/^\d{1,2}$/.test(text)) continue;
      if (chips.some((c) => c === leaf || c.contains(leaf))) continue;
      const n = Number(text);
      if (n >= 1 && n <= 31) out.push(n);
      if (out.length > 1) return out; // already past the day cell
    }
    return out;
  }

  // Walk up from a session block to the day cell holding it — the first
  // ancestor carrying exactly one day number.
  function dayCellOf(chip, chips) {
    for (let node = chip.parentElement, i = 0; node && i < 8; node = node.parentElement, i++) {
      const days = dayNumbers(node, chips);
      if (days.length === 1) return { cell: node, day: days[0] };
      if (days.length > 1) return null; // reached the grid, no single cell
    }
    return null;
  }

  // A month grid shows trailing days of the previous month and leading days of
  // the next. Day numbers only ever decrease at a month boundary, so walking the
  // cells in grid order yields each one's month offset from the header.
  // e.g. [31, 1, 2, ... 30, 1, 2] -> [-1, 0, 0, ... 0, +1, +1]
  function monthOffsets(days) {
    let offset = days.length && days[0] > 15 ? -1 : 0;
    let previous = 0;
    return days.map((day) => {
      if (day < previous) offset += 1;
      previous = day;
      return offset;
    });
  }

  const depth = (el) => {
    let n = 0;
    for (let node = el; node; node = node.parentElement) n++;
    return n;
  };

  function harvestCalendarDom(roster) {
    const header = visibleMonth();
    if (!header) return [];

    // Innermost elements whose text starts with a time — one per session block.
    const matches = [...document.querySelectorAll(TEXT_TAGS)].filter((el) =>
      TIME_RE.test(clean(el.textContent))
    );
    const chips = [];
    for (const el of [...matches].sort((a, b) => depth(b) - depth(a))) {
      if (!chips.some((c) => el.contains(c))) chips.push(el);
    }
    chips.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    if (!chips.length) return [];

    // Grids show trailing days of the previous month and leading days of the
    // next. Day numbers only ever decrease at a month boundary, so walking them
    // in order gives each cell the right month.
    const cells = [];
    const cellOf = new Map();
    for (const chip of chips) {
      const found = dayCellOf(chip, chips);
      if (!found) continue;
      cellOf.set(chip, found);
      if (!cells.some((c) => c.cell === found.cell)) cells.push(found);
    }
    const offsets = new Map();
    monthOffsets(cells.map((c) => c.day)).forEach((value, i) => offsets.set(cells[i].cell, value));

    const out = [];
    for (const chip of chips) {
      const found = cellOf.get(chip);
      if (!found) continue;

      const text = clean(chip.getAttribute("title") || chip.textContent);
      const m = TIME_RE.exec(text);
      if (!m) continue;

      let hour = Number(m[1]) % 12;
      if (/pm/i.test(m[3])) hour += 12;
      const title = (m[4] || "").trim() || text;

      const date = new Date(header.year, header.month + (offsets.get(found.cell) || 0), found.day);
      const p = (n) => String(n).padStart(2, "0");
      const floating = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}T${p(hour)}${p(
        Number(m[2])
      )}00`;
      const ms = new Date(
        date.getFullYear(), date.getMonth(), date.getDate(), hour, Number(m[2]), 0
      ).getTime();

      out.push({
        id: `ktx-dom-${floating}-${title}`.replace(/\s+/g, "-").slice(0, 180),
        title,
        trainer: roster.byColor.get(chipColor(chip)) || "",
        trainerIds: [],
        location: "",
        allDay: false,
        start: { ms, floating, dateOnly: false },
        end: null,
        detail: {},
        source: "dom",
      });
    }
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
      const roster = harvestRoster();
      const domEvents = harvestCalendarDom(roster);

      chrome.storage.local.get(STORE_KEY, (res) => {
        const store = { ...(res[STORE_KEY] || {}) };
        for (const [id, e] of pending) store[id] = e;

        // Resolve facilitator ids captured from JSON against the roster.
        for (const e of Object.values(store)) {
          if (!e.trainer && e.trainerIds && e.trainerIds.length) {
            const named = e.trainerIds.map((id) => roster.byId.get(String(id))).filter(Boolean);
            if (named.length) e.trainer = named.join(", ");
          }
        }

        // The DOM read covers the month on screen. Skip it where the network
        // path already has that month, otherwise every session lands twice.
        const monthsFromNetwork = new Set(
          Object.values(store)
            .filter((e) => e.source !== "dom")
            .map((e) => new Date(e.start.ms).toISOString().slice(0, 7))
        );
        let added = 0;
        for (const e of domEvents) {
          if (monthsFromNetwork.has(new Date(e.start.ms).toISOString().slice(0, 7))) continue;
          if (!store[e.id]) added++;
          store[e.id] = e;
        }
        if (added) chrome.storage.local.set({ [STORE_KEY]: store });

        sendResponse({
          ok: true,
          events: Object.values(store),
          roster: roster.names,
          domCount: domEvents.length,
        });
      });
      return true; // async
    }

    if (msg.type === "KTX_CLEAR") {
      pending.clear();
      chrome.storage.local.remove(STORE_KEY, () => sendResponse({ ok: true }));
      return true;
    }

    if (msg.type === "KTX_DIAGNOSE") {
      const roster = harvestRoster();
      sendResponse({
        ok: true,
        url: location.href,
        payloads: recentPayloads,
        visibleMonth: visibleMonth(),
        rosterNames: roster.names.length,
        rosterIds: [...roster.byId.keys()].slice(0, 5),
        rosterColors: roster.byColor.size,
        domSessionsFound: harvestCalendarDom(roster).length,
        checkboxes: document.querySelectorAll('input[type="checkbox"]').length,
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
    module.exports = { parseDate, toEvent, harvest, personName, idList, rgbKey, monthOffsets };
  }
})();
