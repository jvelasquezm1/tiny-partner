const $ = (id) => document.getElementById(id);
const number = new Intl.NumberFormat("es-ES");
const dateTime = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" });
const relative = new Intl.RelativeTimeFormat("es", { numeric: "auto" });

const sum = (values) => values.reduce((total, value) => total + value, 0);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function ago(time) {
  const minutes = Math.round((time - Date.now()) / 60000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  if (Math.abs(minutes) < 1440) return relative.format(Math.round(minutes / 60), "hour");
  return relative.format(Math.round(minutes / 1440), "day");
}

function setText(values) {
  for (const [id, text] of Object.entries(values)) $(id).textContent = text;
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

async function request(method, path) {
  const response = await fetch(path, { method });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Error ${response.status}`);
  return body;
}

async function load() {
  renderSources(await request("GET", "/admin/api/sources"));
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

load().catch((error) => notify("notice", "error", `No se pudieron cargar los datos: ${error.message}`));
