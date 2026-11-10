import { barList, columnChart, el, emptyChart, formatDay, formatLongDay, number } from "./charts.js";

const $ = (id) => document.getElementById(id);
const dateTime = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" });
const relative = new Intl.RelativeTimeFormat("es", { numeric: "auto" });

const EVENT_SERIES = [
  { key: "feed", label: "Tomas", color: "var(--series-1)" },
  { key: "sleep", label: "Sueño", color: "var(--series-2)" },
  { key: "diaper", label: "Pañales", color: "var(--series-3)" },
];
/** Every Outcome in bot.ts, in Spanish. */
const OUTCOMES = {
  log_event: "Registro",
  ask_about_data: "Pregunta sobre datos",
  ask_guidance: "Pregunta de guía",
  no_source: "Guía sin fuente",
  urgent: "Urgencia",
  other: "Otro",
  unavailable: "Sin servicio",
};

const sum = (values) => values.reduce((total, value) => total + value, 0);
const duration = (ms) => (ms < 1000 ? `${number.format(ms)} ms` : `${number.format(Math.round(ms / 100) / 10)} s`);

function ago(time) {
  const minutes = Math.round((time - Date.now()) / 60000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  if (Math.abs(minutes) < 1440) return relative.format(Math.round(minutes / 60), "hour");
  return relative.format(Math.round(minutes / 1440), "day");
}

function setText(values) {
  for (const [id, text] of Object.entries(values)) $(id).textContent = text;
}

// The usage section's period: a preset number of days or a custom from/to. The server resolves it in the
// bot's time zone and sends back the dates it used, which the date inputs then show.
let period = { days: 14 };
let shownRange = null;

const statsPath = () =>
  `/admin/api/stats?${new URLSearchParams(period.days ? { days: String(period.days) } : { from: period.from, to: period.to })}`;

function renderPeriod(range) {
  shownRange = range;
  for (const button of document.querySelectorAll(".preset")) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.days) === period.days));
  }
  $("range-from").value = range.from;
  $("range-to").value = range.to;
  for (const label of document.querySelectorAll(".range-label")) label.textContent = `${formatDay(range.from)} – ${formatDay(range.to)}`;
}

async function changePeriod(next) {
  const previous = period;
  period = next;
  $("usage").classList.add("is-loading");
  try {
    renderStats(await request("GET", statsPath()));
    $("notice").hidden = true;
  } catch (error) {
    period = previous;
    if (shownRange) renderPeriod(shownRange);
    notify("notice", "error", `No se pudo cambiar el periodo: ${error.message}`);
  } finally {
    $("usage").classList.remove("is-loading");
  }
}

for (const button of document.querySelectorAll(".preset")) {
  button.addEventListener("click", () => changePeriod({ days: Number(button.dataset.days) }));
}
for (const id of ["range-from", "range-to"]) {
  $(id).addEventListener("change", () => {
    const from = $("range-from").value;
    const to = $("range-to").value;
    if (from && to) changePeriod({ from, to });
  });
}

function renderStats({ mode, embedding, messages, events, guidance }) {
  renderPeriod(messages.range);
  const count = (outcome) => messages.byOutcome[outcome] ?? 0;
  const total = sum(Object.values(messages.byOutcome));
  const guidanceQuestions = count("ask_guidance") + count("no_source");
  const eventsTotal = sum(Object.values(events.byKind));

  setText({
    mode: mode.offline ? "Offline (reglas, sin modelos)" : mode.jev ? `Jev + ${mode.generator}` : `${mode.generator} solo`,
    embedding: `${embedding.model} · ${embedding.dimension} dim`,
    "messages-total": number.format(total),
    "messages-urgent": number.format(count("urgent")),
    "no-source": number.format(count("no_source")),
    "no-source-note": guidanceQuestions
      ? `de ${number.format(guidanceQuestions)} preguntas de guía (${Math.round((count("no_source") / guidanceQuestions) * 100)} %)`
      : "Sin preguntas de guía en este periodo",
    "latency-avg": messages.avgMs === null ? "–" : duration(messages.avgMs),
    "latency-note": messages.p95Ms === null ? "Sin mensajes en este periodo" : `El 95 % en menos de ${duration(messages.p95Ms)}`,
    "events-total": number.format(eventsTotal),
    "events-feed": number.format(events.byKind.feed ?? 0),
    "events-sleep": number.format(events.byKind.sleep ?? 0),
    "events-diaper": number.format(events.byKind.diaper ?? 0),
    households: number.format(events.households),
    "chunk-size": guidance.avgChunkChars === null ? "–" : number.format(guidance.avgChunkChars),
  });

  if (total) {
    columnChart($("messages-chart"), messages.perDay, [{ key: "count", label: "Mensajes", color: "var(--series-1)" }]);
    const outcomes = Object.entries(OUTCOMES).map(([outcome, label]) => ({ label, value: count(outcome) }));
    barList($("outcomes"), outcomes.sort((a, b) => b.value - a.value), "var(--series-1)");
  } else {
    emptyChart($("messages-chart"), "Sin mensajes en este periodo. Se cuentan desde que se activaron las estadísticas.");
    $("outcomes").replaceChildren(el("li", "chart-empty", "Sin mensajes en este periodo."));
  }

  const perDayTotals = events.perDay.map((day) => sum(EVENT_SERIES.map(({ key }) => day[key])));
  if (sum(perDayTotals)) columnChart($("events-chart"), events.perDay, EVENT_SERIES);
  else emptyChart($("events-chart"), "Sin eventos en los últimos 14 días.");
  $("events-table").replaceChildren(
    ...events.perDay.map((day, i) => {
      const row = el("tr");
      row.append(el("td", "", formatLongDay(day.day)), ...EVENT_SERIES.map(({ key }) => el("td", "", number.format(day[key]))));
      row.append(el("td", "", number.format(perDayTotals[i])));
      return row;
    }),
  );
}

function sourceRow(source) {
  const doc = el("div", "doc");
  const link = el("a", "url", source.url);
  if (/^https?:\/\//.test(source.url)) link.href = source.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  doc.append(el("p", "title", source.title), link);
  const chunks = el("span", "num", number.format(source.chunks));
  chunks.dataset.label = "fragmentos";
  const item = el("li", "row");
  item.append(doc, chunks, el("span", "num when", dateTime.format(new Date(source.ingestedAt))));
  return item;
}

function renderSources(sources) {
  $("sources").replaceChildren(...sources.map(sourceRow));
  $("empty").hidden = sources.length > 0;
  const latest = Math.max(...sources.map((source) => new Date(source.ingestedAt).getTime()));
  setText({
    documents: number.format(sources.length),
    chunks: number.format(sum(sources.map((source) => source.chunks))),
    last: sources.length ? ago(latest) : "nunca",
  });
}

function notify(id, kind, text) {
  const notice = $(id);
  notice.className = `notice ${kind}`;
  notice.textContent = text;
  notice.hidden = false;
}

async function request(method, path, payload) {
  const init = payload === undefined ? { method } : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
  const response = await fetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Error ${response.status}`);
  return body;
}

async function load() {
  const [stats, sources] = await Promise.all([request("GET", statsPath()), request("GET", "/admin/api/sources")]);
  renderStats(stats);
  renderSources(sources);
}

/** Disables a button and swaps its label for `busyLabel` while `work` runs. */
async function whileBusy(button, busyLabel, work) {
  const label = button.querySelector(".label");
  const idle = label.textContent;
  button.disabled = true;
  button.querySelector(".spinner").hidden = false;
  label.textContent = busyLabel;
  try {
    await work();
  } finally {
    button.disabled = false;
    button.querySelector(".spinner").hidden = true;
    label.textContent = idle;
  }
}

function syncSummary({ files, removedChunks }) {
  let message = `Reindexados ${files.length} documentos (${sum(files.map((file) => file.chunks))} fragmentos).`;
  if (removedChunks) message += ` Eliminados ${removedChunks} fragmentos de guías que ya no están en guidance/.`;
  return message;
}

$("sync").addEventListener("click", () =>
  whileBusy($("sync"), "Reindexando…", async () => {
    try {
      notify("sync-notice", "ok", syncSummary(await request("POST", "/admin/api/sync")));
      await load();
    } catch (error) {
      notify("sync-notice", "error", `No se pudo reindexar: ${error.message}`);
    }
  }),
);

// Adding a guide: the file's own front matter, or its first heading, fills in the form.
const dialog = $("add-dialog");
const form = $("add-form");
let upload = null;

$("add").addEventListener("click", () => {
  form.reset();
  upload = null;
  $("add-error").hidden = true;
  dialog.showModal();
});
$("add-cancel").addEventListener("click", () => dialog.close());

$("add-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const content = (await file.text()).replace(/\r\n/g, "\n");
  upload = { fileName: file.name, content };
  const front = content.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
  const field = (name) => front.match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1].trim() ?? "";
  const fill = (id, value) => {
    if (value && !$(id).value) $(id).value = value;
  };
  fill("add-title", field("title") || content.match(/^#\s+(.+)$/m)?.[1].trim());
  fill("add-url", field("url"));
  fill("add-source", field("source"));
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!upload) return;
  const guide = { ...upload, title: $("add-title").value, url: $("add-url").value, source: $("add-source").value };
  return whileBusy($("add-submit"), "Añadiendo…", async () => {
    try {
      const { file, ...synced } = await request("POST", "/admin/api/guides", guide);
      dialog.close();
      notify("sync-notice", "ok", `Añadida guidance/${file}. ${syncSummary(synced)} Haz commit del archivo para que no se pierda al desplegar.`);
      await load();
    } catch (error) {
      $("add-error").textContent = `No se pudo añadir: ${error.message}`;
      $("add-error").hidden = false;
    }
  });
});

load().catch((error) => notify("notice", "error", `No se pudieron cargar los datos: ${error.message}`));
