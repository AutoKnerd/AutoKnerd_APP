# Kia Training Calendar Export

A small Chrome extension: on the Kia Training calendar, pick a trainer and a
month, hit export, and get a `.ics` file that opens straight into Outlook,
Apple Calendar, or imports into Google Calendar — with the session details
carried across.

## Install (unpacked)

1. `chrome://extensions` → turn on **Developer mode** (top right).
2. **Load unpacked** → select this folder (`extensions/kia-calendar-export`).
3. Pin the extension so its icon is visible in the toolbar.

## Use

1. Open the Kia Training calendar and log in.
2. **Reload the page** (the extension captures calendar data as it loads).
3. Browse to the month you want. Click through any months you want included —
   each one is captured as you view it.
4. Click the extension icon → pick a **trainer** and a **month** → **Export to
   .ics**.

Double-click the downloaded file to add it to Outlook or Apple Calendar. For
Google Calendar: Settings → Import & export → Import.

## How it works

Rather than scraping the calendar grid — brittle, and most session detail is
hidden behind a click — the extension listens to the calendar's own data:

- `interceptor.js` runs in the page's JS world and patches `fetch` /
  `XMLHttpRequest`, forwarding JSON responses to the extension. It also sweeps
  server-rendered payloads (`__NEXT_DATA__`, inline `application/json`).
- `content.js` walks those payloads looking for event-shaped objects — anything
  with a parseable start date plus a title — and normalises them. Field names
  are matched by intent (`start`/`starts_at`/`session_date`…), so it doesn't
  depend on knowing the exact schema. Fields it doesn't recognise are kept and
  written into the event description, so no session detail is lost.
- `ics.js` writes RFC 5545 output. `popup.js` handles filtering and download.
- If no JSON call is found, `content.js` falls back to a generic DOM sweep
  (`[data-start]`, `[data-date]`, `<time datetime>`).

Captured events are kept in `chrome.storage.local` so browsing several months
accumulates them. **Clear captured** empties that store. Nothing is sent
anywhere — no network calls, no analytics, no remote code.

## Times and timezones

The `.ics` mirrors how the source expressed each time, which is what stops
sessions landing an hour out:

| Source                      | Written as                      |
| --------------------------- | ------------------------------- |
| `2026-09-14`                | `DTSTART;VALUE=DATE` (all-day)  |
| `2026-09-14T09:00:00`       | floating local time — 09:00 stays 09:00 |
| `2026-09-14T09:00:00Z`/`+01:00` | UTC                         |

Sessions with no end time get one hour (all-day: one day), calculated on
wall-clock components so it survives a DST changeover.

## Tests

```bash
node extensions/kia-calendar-export/test/run.js
```

Covers date normalisation, event harvesting from nested payloads, and `.ics`
correctness (line folding at 75 octets, CRLF, escaping, DST-safe end times).
Worth running under a few timezones:

```bash
for tz in Europe/London America/New_York Australia/Sydney; do
  TZ=$tz node extensions/kia-calendar-export/test/run.js
done
```

## If nothing is captured

The field-name heuristics are generic because the site's actual schema hasn't
been inspected. If the popup finds no sessions, or finds sessions but no trainer
names:

1. Click **Diagnose** — it copies a report to the clipboard describing the
   payload shapes seen (keys and counts, not their contents).
2. Send that report over and the matching rules in `content.js` (`RE`) can be
   pinned to the real field names — usually a one-line change.
