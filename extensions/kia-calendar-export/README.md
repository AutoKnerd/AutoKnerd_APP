# Kia Training Calendar Export

A small Chrome extension: on the Kia Training Workshop Calendar, pick a
facilitator and a month, hit export, and get a `.ics` file that opens straight
into Outlook, Apple Calendar, or imports into Google Calendar — with the
session details carried across.

## Install (unpacked)

1. `chrome://extensions` → turn on **Developer mode** (top right).
2. **Load unpacked** → select this folder (`extensions/kia-calendar-export`).
3. Pin the extension so its icon is visible in the toolbar.

## Use

1. Open `kiatraining.com/calendar` and log in.
2. **Reload the page** — the extension captures calendar data as it loads.
3. Browse to the month you want. Each month you view is captured.
4. Click the extension icon → pick a **facilitator** and a **month** →
   **Export to .ics**.

Double-click the downloaded file to add it to Outlook or Apple Calendar. For
Google Calendar: Settings → Import & export → Import.

## How it works

Scraping the calendar grid is brittle and most session detail sits behind a
click, so the extension prefers the calendar's own data:

- `interceptor.js` runs in the page's JS world, patches `fetch` /
  `XMLHttpRequest`, and forwards JSON responses to the extension. It also sweeps
  server-rendered payloads (`__NEXT_DATA__`, inline `application/json`).
- `content.js` walks those payloads for event-shaped objects — a parseable start
  date plus a title. Field names are matched by intent
  (`start` / `starts_at` / `session_date`…), so it doesn't depend on knowing the
  schema. Unrecognised fields are kept and written into the event description,
  so no session detail is lost.
- `ics.js` writes RFC 5545 output; `popup.js` handles filtering and download.

### Putting a name on a session

The calendar filters by facilitator using a checkbox roster, and colours each
session block to match that person's chip. Events themselves generally reference
a facilitator by **id**, not by name — so the extension resolves names three
ways, in order:

1. A name carried directly on the event (`facilitator: {firstName, lastName}`).
2. A facilitator **id** on the event (`facilitator_id`, `facilitators: [3, 8]`),
   resolved against the sidebar roster — the checkbox values are the same ids
   the app uses.
3. The session block's **background colour**, matched to the roster chip colour.

The roster is read by anchoring on the visible "Filter by Facilitator" heading
and taking the coloured checkboxes after it, rather than guessing class names.
Roster names populate the dropdown even before any session matches, so an empty
dropdown means the roster read failed — not that no sessions were found.

### DOM fallback

If a month produced no JSON, the extension reads it off the grid: session blocks
are found by their `9:30 AM …` prefix, each one is walked up to its day cell, and
the grid's leading/trailing days are attributed to the neighbouring month
(day numbers only ever decrease at a month boundary). The DOM read is skipped for
any month the network path already covered, so sessions can't land twice.

Captured events live in `chrome.storage.local`, so browsing several months
accumulates them. **Clear captured** empties that store. Nothing leaves the
browser — no network calls, no analytics, no remote code.

## Times and timezones

The `.ics` mirrors how the source expressed each time, which is what stops
sessions landing an hour out:

| Source                          | Written as                              |
| ------------------------------- | --------------------------------------- |
| `2026-09-14`                    | `DTSTART;VALUE=DATE` (all-day)          |
| `2026-09-14T09:00:00`           | floating local time — 09:00 stays 09:00 |
| `2026-09-14T09:00:00Z`/`+01:00` | UTC                                     |

Sessions with no end time get one hour (all-day: one day), calculated on
wall-clock components so it survives a DST changeover.

## Tests

```bash
node extensions/kia-calendar-export/test/run.js
```

31 assertions covering date normalisation, event harvesting from nested
payloads, facilitator id/colour resolution, the month-grid offset logic, and
`.ics` correctness (75-octet folding, CRLF, escaping, DST-safe end times).
Worth running under a few timezones:

```bash
for tz in Europe/London America/New_York Australia/Sydney; do
  TZ=$tz node extensions/kia-calendar-export/test/run.js
done
```

The DOM-reading code isn't covered — it needs a real browser. Its one piece of
tricky logic (`monthOffsets`) is pure and is tested.

## If something doesn't line up

Click **Diagnose**. It copies a report to the clipboard describing what was
seen — payload shapes, roster size, whether the visible month was recognised,
how many sessions the DOM read found. Key names and counts, not your data.
That report is enough to pin the matching rules in `content.js` to the real
schema, usually a one-line change.
