# Handoff — Kia Training Calendar Export extension

Context for a local Claude Code session picking this up from a Claude Code
on-the-web session. Read `README.md` alongside this.

## Goal (from the user, Andrew)

A Chrome extension so a trainer can, on the Kia Training Workshop Calendar
(`kiatraining.com/calendar`), pick their name + a month, hit export, and get the
sessions into Outlook / iCal. Built as an `.ics` export (universal — opens in
Outlook, Apple Calendar, imports into Google Calendar).

## Where it lives

- Branch: `claude/kiatraining-calendar-export-1i5nsb` (pushed to origin).
- Folder: `extensions/kia-calendar-export/`. Self-contained; unrelated to the
  rest of the AutoKnerd app.
- Load it: `chrome://extensions` → Developer mode → Load unpacked → that folder.

## Design in one line

Don't scrape the grid — capture the calendar's own JSON. `interceptor.js`
(page-world) patches fetch/XHR and forwards JSON; `content.js` (isolated world)
walks it for event-shaped objects and normalises them; `popup.js` filters by
facilitator + month; `ics.js` writes RFC 5545. Field names matched by intent,
so no hard dependency on the site's schema.

## What's DONE and tested

- JSON capture + generic event harvesting.
- `.ics` writer: floating-local vs UTC vs all-day, 75-octet folding, escaping,
  DST-safe inferred end times. 31 assertions in `test/run.js`, green under
  Europe/London, America/New_York, Australia/Sydney:
  `node test/run.js`
- Facilitator-name resolution (the site calls trainers "Facilitators"): a
  sidebar checkbox roster with a colour chip per person; events reference a
  facilitator by **id**, not name. Resolved 3 ways — name on event → id looked
  up against roster (checkbox values) → session block background colour matched
  to roster chip colour. Roster read anchors on the visible "Filter by
  Facilitator" heading.

## THE OPEN QUESTION — verify against the real page

Everything about the site's actual data is **inferred from one screenshot**, not
confirmed. The user has a local Chrome with the calendar open and is logged in.
First job: **actually look at the page** (Playwright/DevTools) and confirm or
correct:

1. **Is there already a native Export?** The sidebar has a red **Export** button.
   If it already emits `.ics`, this extension may be redundant — check what it
   produces before doing more.
2. **The calendar's data source.** Open DevTools → Network, reload
   `kiatraining.com/calendar`, and find the request that returns the sessions.
   Confirm: is it JSON (our main path) or server-rendered HTML (DOM fallback)?
   Capture one real event object — the actual field names for start/end/title/
   facilitator/location. Then pin the `RE` heuristics in `content.js` to them.
3. **Facilitator linkage.** In a real event object, is the facilitator a name, a
   nested object, or an id? If an id — do the sidebar checkbox `value`s carry the
   same ids? That's the assumption the roster lookup rests on. Verify it.
4. **Times.** Do session timestamps carry a timezone/offset, or are they
   zone-less? This decides whether `.ics` should emit floating-local or UTC.
   Confirm one exported session lands at the right wall-clock time in Outlook.

There's a **Diagnose** button in the popup that dumps observed payload shapes,
roster size, recognised month, and DOM-session count — use it to sanity-check,
but prefer reading the real Network response directly now that you have the
browser.

## Guardrails

- Everything stays client-side. No network calls out, no analytics, no remote
  code. Keep it that way.
- The DOM-reading code (`harvestCalendarDom`, `harvestRoster`) can't be unit
  tested without a browser; the one pure piece (`monthOffsets`) is tested. If
  you touch grid parsing, verify in a live browser.
- Run `node test/run.js` after any change to `content.js` / `ics.js`.

## Commit attribution

End commit messages with:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```
