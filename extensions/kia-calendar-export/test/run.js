// Node test harness: `node extensions/kia-calendar-export/test/run.js`
// Exercises the two pieces that carry real risk — date normalisation /
// event harvesting, and the .ics writer.

const assert = require("assert");
const path = require("path");

// content.js expects a browser; stub just enough for it to load.
global.window = { addEventListener() {} };
global.chrome = {
  storage: { local: { get(_k, cb) { cb && cb({}); }, set() {}, remove(_k, cb) { cb && cb(); } } },
  runtime: { onMessage: { addListener() {} }, lastError: null },
};
global.document = { querySelectorAll: () => [] };

const { parseDate, harvest, idList, rgbKey, monthOffsets } = require(path.join(__dirname, "..", "content.js"));
const ics = require(path.join(__dirname, "..", "ics.js"));

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}\n      ${err.message}`);
    process.exitCode = 1;
  }
};

console.log("date parsing");

test("date-only string is all-day", () => {
  const r = parseDate("2026-09-14");
  assert.strictEqual(r.dateOnly, true);
  assert.strictEqual(r.floating, "20260914");
});

test("zone-less timestamp stays floating local", () => {
  const r = parseDate("2026-09-14T09:30:00");
  assert.strictEqual(r.dateOnly, false);
  assert.strictEqual(r.floating, "20260914T093000");
});

test("space-separated SQL datetime is floating local", () => {
  assert.strictEqual(parseDate("2026-09-14 14:05:00").floating, "20260914T140500");
});

test("zoned timestamp keeps UTC (no floating)", () => {
  const r = parseDate("2026-09-14T09:30:00Z");
  assert.strictEqual(r.floating, null);
  assert.strictEqual(r.ms, Date.parse("2026-09-14T09:30:00Z"));
});

test("epoch seconds and millis both work", () => {
  assert.strictEqual(parseDate(1789000000).ms, 1789000000000);
  assert.strictEqual(parseDate(1789000000000).ms, 1789000000000);
});

test("junk is rejected", () => {
  assert.strictEqual(parseDate("next tuesday-ish"), null);
  assert.strictEqual(parseDate(""), null);
  assert.strictEqual(parseDate(null), null);
});

console.log("harvesting");

test("finds events nested anywhere in a payload", () => {
  const payload = {
    data: {
      calendar: {
        weeks: [
          { days: [{ sessions: [
            { id: 42, title: "EV Master Tech", startDate: "2026-09-14T09:00:00",
              endDate: "2026-09-14T17:00:00", instructor: { firstName: "Sam", lastName: "Doe" },
              venue: "Kia Academy Bristol", capacity: 12 },
          ] }] },
        ],
      },
    },
  };
  const found = harvest(payload, "https://kiatraining.com/api/calendar");
  assert.strictEqual(found.length, 1);
  const e = found[0];
  assert.strictEqual(e.title, "EV Master Tech");
  assert.strictEqual(e.trainer, "Sam Doe");
  assert.strictEqual(e.location, "Kia Academy Bristol");
  assert.strictEqual(e.start.floating, "20260914T090000");
  assert.strictEqual(e.end.floating, "20260914T170000");
  // unrecognised fields are preserved so no session detail is lost
  assert.strictEqual(e.detail.capacity, "12");
});

test("objects with a date but no title are ignored", () => {
  assert.strictEqual(harvest({ items: [{ start_date: "2026-09-14", count: 3 }] }, "x").length, 0);
});

test("objects with no date are ignored", () => {
  assert.strictEqual(harvest({ user: { name: "Sam Doe", role: "trainer" } }, "x").length, 0);
});

test("survives circular structures", () => {
  const node = { name: "Loop" };
  node.self = node;
  assert.doesNotThrow(() => harvest(node, "x"));
});

console.log("facilitator resolution");

test("facilitator ids are extracted from every shape", () => {
  assert.deepStrictEqual(idList(7), ["7"]);
  assert.deepStrictEqual(idList("7"), ["7"]);
  assert.deepStrictEqual(idList([7, 9]), ["7", "9"]);
  assert.deepStrictEqual(idList({ id: 7 }), ["7"]);
  assert.deepStrictEqual(idList([{ id: 7 }, { id: 9 }]), ["7", "9"]);
  assert.deepStrictEqual(idList(null), []);
});

test("a human name is never mistaken for an id", () => {
  assert.deepStrictEqual(idList("Angela Gay"), []);
});

test("an event carrying only a facilitator id keeps it for later resolution", () => {
  const [e] = harvest({ sessions: [{ title: "MISC: CX/Skills Coaching", start: "2026-09-02T11:00:00", facilitator_id: 12 }] }, "x");
  assert.strictEqual(e.trainer, "");
  assert.deepStrictEqual(e.trainerIds, ["12"]);
});

test("a facilitator array of ids is kept", () => {
  const [e] = harvest({ items: [{ name: "EA Region", startDate: "2026-09-03T11:00:00", facilitators: [3, 8] }] }, "x");
  assert.deepStrictEqual(e.trainerIds, ["3", "8"]);
});

test("a nested facilitator object still resolves to a name", () => {
  const [e] = harvest({ items: [{ name: "Seltos Product", startDate: "2026-09-03T09:30:00", facilitator: { firstName: "Angela", lastName: "Gay" } }] }, "x");
  assert.strictEqual(e.trainer, "Angela Gay");
});

test("chip colours normalise for matching", () => {
  assert.strictEqual(rgbKey("rgb(180, 60, 40)"), "180,60,40");
  assert.strictEqual(rgbKey("rgba(180, 60, 40, 0.9)"), "180,60,40");
  assert.strictEqual(rgbKey("rgba(0, 0, 0, 0)"), ""); // transparent isn't a chip
  assert.strictEqual(rgbKey("transparent"), "");
});

console.log("calendar grid");

test("leading and trailing days get the neighbouring month", () => {
  // The Sept 2026 grid in the screenshot opens on Mon 31 Aug.
  const days = [31, 1, 2, 3, 4, 7, 8, 30, 1, 2];
  assert.deepStrictEqual(monthOffsets(days), [-1, 0, 0, 0, 0, 0, 0, 0, 1, 1]);
});

test("a grid starting on the 1st has no leading month", () => {
  assert.deepStrictEqual(monthOffsets([1, 2, 3]), [0, 0, 0]);
});

test("empty grid is handled", () => {
  assert.deepStrictEqual(monthOffsets([]), []);
});

console.log("ics output");

const sample = [
  { id: "a1", title: "EV Master Tech; Level 2, Day 1", trainer: "Sam Doe",
    location: "Kia Academy Bristol", detail: { capacity: "12" },
    start: { ms: Date.parse("2026-09-14T09:00:00Z"), floating: "20260914T090000", dateOnly: false },
    end: { ms: Date.parse("2026-09-14T17:00:00Z"), floating: "20260914T170000", dateOnly: false } },
  { id: "a2", title: "Study day", trainer: "Sam Doe", location: "", detail: {},
    start: { ms: Date.parse("2026-09-15T00:00:00Z"), floating: "20260915", dateOnly: true }, end: null },
];

const out = ics.buildIcs(sample, "Kia Training — Sam Doe — September 2026");

test("has a well-formed envelope", () => {
  assert.ok(out.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(out.trimEnd().endsWith("END:VCALENDAR"));
  assert.strictEqual((out.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.strictEqual((out.match(/BEGIN:VEVENT/g) || []).length, (out.match(/END:VEVENT/g) || []).length);
});

test("uses CRLF line endings throughout", () => {
  assert.strictEqual(out.split("\n").length - 1, out.split("\r\n").length - 1);
});

test("floating times are written without Z", () => {
  assert.ok(out.includes("DTSTART:20260914T090000"));
  assert.ok(out.includes("DTEND:20260914T170000"));
});

test("all-day event uses VALUE=DATE and rolls to the next day", () => {
  assert.ok(out.includes("DTSTART;VALUE=DATE:20260915"));
  assert.ok(out.includes("DTEND;VALUE=DATE:20260916"));
});

test("special characters in titles are escaped", () => {
  assert.ok(out.includes("SUMMARY:EV Master Tech\\; Level 2\\, Day 1"));
});

test("detail fields land in the description", () => {
  assert.ok(out.includes("Trainer: Sam Doe"));
  assert.ok(out.includes("Capacity: 12"));
});

test("no unfolded line exceeds 75 octets", () => {
  for (const line of out.split("\r\n")) {
    assert.ok(Buffer.byteLength(line, "utf8") <= 75, `line too long: ${line}`);
  }
});

test("folding round-trips (unfold restores the original)", () => {
  const long = "DESCRIPTION:" + "x".repeat(400);
  assert.strictEqual(ics.fold(long).replace(/\r\n /g, ""), long);
});

test("missing end time defaults to one hour", () => {
  const start = parseDate("2026-09-14T09:00:00");
  assert.strictEqual(ics.inferEnd(start).floating, "20260914T100000");
});

test("missing end time is DST-safe on a spring-forward morning", () => {
  // 29 Mar 2026 is the UK/EU clock change; wall-clock +1h must still read 10:00.
  const start = parseDate("2026-03-29T09:00:00");
  assert.strictEqual(ics.inferEnd(start).floating, "20260329T100000");
});

test("missing end time on an all-day event rolls one day", () => {
  assert.strictEqual(ics.inferEnd(parseDate("2026-12-31")).floating, "20270101");
});

test("zoned start with no end still gets a UTC end", () => {
  const start = parseDate("2026-09-14T09:00:00Z");
  const end = ics.inferEnd(start);
  assert.strictEqual(end.floating, null);
  assert.strictEqual(ics.dateProp("DTEND", end), "DTEND:20260914T100000Z");
});

console.log(`\n${passed} assertions passed${process.exitCode ? " (with failures)" : ""}`);
