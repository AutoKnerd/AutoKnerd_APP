// Popup: filter the captured sessions by trainer + month, build an .ics, download it.

const els = {
  trainer: document.getElementById("trainer"),
  month: document.getElementById("month"),
  exportBtn: document.getElementById("export"),
  rescan: document.getElementById("rescan"),
  clear: document.getElementById("clear"),
  diagnose: document.getElementById("diagnose"),
  status: document.getElementById("status"),
  preview: document.getElementById("preview"),
  hint: document.getElementById("hint"),
};

let allEvents = [];

// ------------------------------------------------------------------ helpers
const setStatus = (text) => (els.status.textContent = text);

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const monthKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const monthLabel = (key) => {
  const [y, m] = key.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
};

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function send(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (res) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(res || { ok: false, error: "No response from page." });
    });
  });
}

// ------------------------------------------------------------------- filter
function filtered() {
  const trainer = els.trainer.value;
  const month = els.month.value;
  return allEvents
    .filter((e) => (!trainer || e.trainer === trainer) && (!month || monthKey(e.start.ms) === month))
    .sort((a, b) => a.start.ms - b.start.ms);
}

function renderPreview() {
  const list = filtered();
  els.exportBtn.disabled = list.length === 0;
  els.exportBtn.textContent = list.length
    ? `Export ${list.length} session${list.length === 1 ? "" : "s"} to .ics`
    : "Export to .ics";

  if (!list.length) {
    els.preview.hidden = true;
    return;
  }
  els.preview.hidden = false;
  els.preview.innerHTML = "";
  for (const e of list.slice(0, 60)) {
    const div = document.createElement("div");
    div.className = "ev";
    const when = new Date(e.start.ms).toLocaleString(undefined, {
      weekday: "short", day: "numeric", month: "short",
      ...(e.start.dateOnly ? {} : { hour: "numeric", minute: "2-digit" }),
    });
    div.innerHTML = `<div>${escapeHtml(e.title)}</div><div class="when">${escapeHtml(when)}${
      e.trainer ? " · " + escapeHtml(e.trainer) : ""
    }</div>`;
    els.preview.appendChild(div);
  }
  if (list.length > 60) {
    const more = document.createElement("div");
    more.className = "when";
    more.textContent = `…and ${list.length - 60} more`;
    els.preview.appendChild(more);
  }
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function populate() {
  const trainers = [...new Set(allEvents.map((e) => e.trainer).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
  const months = [...new Set(allEvents.map((e) => monthKey(e.start.ms)))].sort();

  const keepTrainer = els.trainer.value;
  const keepMonth = els.month.value;

  els.trainer.innerHTML = '<option value="">All trainers</option>';
  for (const t of trainers) {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    els.trainer.appendChild(opt);
  }
  if (trainers.includes(keepTrainer)) els.trainer.value = keepTrainer;

  els.month.innerHTML = '<option value="">All dates found</option>';
  for (const m of months) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = monthLabel(m);
    els.month.appendChild(opt);
  }
  if (months.includes(keepMonth)) els.month.value = keepMonth;
  else if (months.includes(monthKey(Date.now()))) els.month.value = monthKey(Date.now());

  if (!trainers.length && allEvents.length) {
    els.hint.textContent =
      "No trainer names were recognised in the session data — export will include every session found. Hit Diagnose and send me the output to fix that.";
  }
}

// -------------------------------------------------------------------- scan
async function scan(quiet) {
  const tab = await activeTab();
  if (!tab || !/kiatraining\.com/.test(tab.url || "")) {
    setStatus("Open your Kia Training calendar tab, then reopen this popup.");
    return;
  }
  if (!quiet) setStatus("Scanning…");

  const res = await send(tab.id, { type: "KTX_SCAN" });
  if (!res.ok) {
    setStatus("Couldn't read the page. Reload the calendar tab and try again.");
    return;
  }

  allEvents = (res.events || []).filter((e) => e && e.start && typeof e.start.ms === "number");
  populate();
  renderPreview();

  if (!allEvents.length) {
    setStatus("Nothing found yet. Reload the calendar, click through the month, then Rescan.");
  } else {
    setStatus(`${allEvents.length} session${allEvents.length === 1 ? "" : "s"} captured.`);
  }
}

// ------------------------------------------------------------------ export
async function doExport() {
  const list = filtered();
  if (!list.length) return;

  const trainer = els.trainer.value || "All trainers";
  const month = els.month.value ? monthLabel(els.month.value) : "All dates";
  const ics = KTX_ICS.buildIcs(list, `Kia Training — ${trainer} — ${month}`);

  const safe = (s) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const filename = `Kia-Training-${safe(trainer)}-${safe(els.month.value || "all")}.ics`;

  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  chrome.downloads.download({ url, filename, saveAs: true }, () => {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setStatus(chrome.runtime.lastError ? "Download blocked by Chrome." : `Exported ${list.length} sessions.`);
  });
}

// ---------------------------------------------------------------- diagnose
async function doDiagnose() {
  const tab = await activeTab();
  if (!tab) return;
  const res = await send(tab.id, { type: "KTX_DIAGNOSE" });
  if (!res.ok) {
    setStatus("Diagnose failed — reload the calendar tab.");
    return;
  }
  const report = JSON.stringify(
    { url: res.url, eventsCaptured: allEvents.length, payloads: res.payloads,
      domCandidates: res.domCandidates, calendarClasses: res.calendarClasses },
    null, 2
  );
  els.preview.hidden = false;
  els.preview.innerHTML = `<pre>${escapeHtml(report)}</pre>`;
  try {
    await navigator.clipboard.writeText(report);
    setStatus("Diagnostics copied to clipboard — paste them to me.");
  } catch (_) {
    setStatus("Diagnostics below — copy and paste them to me.");
  }
}

// ------------------------------------------------------------------- wiring
els.trainer.addEventListener("change", renderPreview);
els.month.addEventListener("change", renderPreview);
els.exportBtn.addEventListener("click", doExport);
els.rescan.addEventListener("click", () => scan(false));
els.diagnose.addEventListener("click", doDiagnose);
els.clear.addEventListener("click", async () => {
  const tab = await activeTab();
  if (tab) await send(tab.id, { type: "KTX_CLEAR" });
  allEvents = [];
  populate();
  renderPreview();
  setStatus("Cleared. Reload the calendar to capture again.");
});

scan(true);
