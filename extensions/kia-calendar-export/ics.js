// RFC 5545 .ics writer. Kept free of DOM/chrome APIs so it can be unit tested.
(function (root) {
  const pad = (n) => String(n).padStart(2, "0");

  // Escape \ ; , and newlines in TEXT values.
  function escapeText(value) {
    return String(value == null ? "" : value)
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r?\n/g, "\\n");
  }

  // Content lines are limited to 75 octets; continuations start with a space.
  function fold(line) {
    const encoder = new TextEncoder();
    if (encoder.encode(line).length <= 75) return line;
    const parts = [];
    let current = "";
    let size = 0;
    for (const char of line) {
      const charSize = encoder.encode(char).length;
      if (size + charSize > (parts.length ? 74 : 75)) {
        parts.push(current);
        current = "";
        size = 0;
      }
      current += char;
      size += charSize;
    }
    if (current) parts.push(current);
    return parts.map((part, i) => (i ? " " + part : part)).join("\r\n");
  }

  const utcStamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

  // Emit the form matching how the source expressed the time:
  // all-day -> VALUE=DATE, zone-less -> floating local, zoned -> UTC.
  function dateProp(name, value) {
    if (value.dateOnly) return `${name};VALUE=DATE:${value.floating}`;
    if (value.floating) return `${name}:${value.floating}`;
    return `${name}:${utcStamp(value.ms)}`;
  }

  // No end in the source: +1 day for all-day, +1 hour otherwise.
  //
  // For a floating start the arithmetic is done on the wall-clock components
  // via UTC, never on the local-time `ms`. Doing it locally would both drift
  // from the floating value and shift the clock across a DST boundary — a
  // 09:00 session on the spring-forward Sunday would end at 11:00.
  function inferEnd(start) {
    const step = start.dateOnly ? 86400000 : 3600000;

    if (start.floating) {
      const f = start.floating;
      const base = Date.UTC(
        +f.slice(0, 4),
        +f.slice(4, 6) - 1,
        +f.slice(6, 8),
        f.length > 8 ? +f.slice(9, 11) : 0,
        f.length > 8 ? +f.slice(11, 13) : 0,
        f.length > 8 ? +f.slice(13, 15) : 0
      );
      const d = new Date(base + step);
      const floating = start.dateOnly
        ? `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
        : `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(
            d.getUTCMinutes()
          )}${pad(d.getUTCSeconds())}`;
      return { ms: start.ms + step, dateOnly: start.dateOnly, floating };
    }

    return { ms: start.ms + step, dateOnly: start.dateOnly, floating: null };
  }

  function buildIcs(events, calendarName) {
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//AutoKnerd//Kia Training Calendar Export//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `X-WR-CALNAME:${escapeText(calendarName)}`,
    ];

    const stamp = utcStamp(Date.now());

    for (const event of events) {
      const end = event.end && event.end.ms > event.start.ms ? event.end : inferEnd(event.start);

      const description = [];
      if (event.trainer) description.push(`Trainer: ${event.trainer}`);
      for (const [key, value] of Object.entries(event.detail || {})) {
        const label = key.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
        description.push(`${label.charAt(0).toUpperCase() + label.slice(1)}: ${value}`);
      }

      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${escapeText(event.id)}@kiatraining.export`);
      lines.push(`DTSTAMP:${stamp}`);
      lines.push(dateProp("DTSTART", event.start));
      lines.push(dateProp("DTEND", end));
      lines.push(`SUMMARY:${escapeText(event.title)}`);
      if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
      if (description.length) lines.push(`DESCRIPTION:${escapeText(description.join("\n"))}`);
      lines.push("TRANSP:OPAQUE");
      lines.push("END:VEVENT");
    }

    lines.push("END:VCALENDAR");
    return lines.map(fold).join("\r\n") + "\r\n";
  }

  const api = { escapeText, fold, utcStamp, dateProp, inferEnd, buildIcs };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.KTX_ICS = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
