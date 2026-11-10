// Small HTML charts for the admin page. Thin columns with a 2px gap between stacked segments, a tooltip per
// column on hover and keyboard focus, every value also reachable without it. Text is set with textContent only.

export const number = new Intl.NumberFormat("es-ES");
const shortDay = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "UTC" });
const longDay = new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** Days arrive as YYYY-MM-DD in the bot's time zone: format them as calendar dates, never shifted. */
export const formatDay = (day) => shortDay.format(new Date(`${day}T00:00:00Z`));
export const formatLongDay = (day) => longDay.format(new Date(`${day}T00:00:00Z`));

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The smallest of 1, 2, 5 × 10^k at or above `value`, so the axis ends on a round number. */
function niceMax(value) {
  if (value <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 5, 10].map((step) => step * magnitude).find((candidate) => candidate >= value);
}

/**
 * One column per row; several series stack in their given order, first at the bottom.
 * rows: [{ day, [key]: number }] · series: [{ key, label, color }]
 */
export function columnChart(container, rows, series) {
  const totals = rows.map((row) => series.reduce((sum, { key }) => sum + row[key], 0));
  const max = niceMax(Math.max(...totals));
  const plot = el("div", "plot");
  for (const tick of max % 2 === 0 ? [0, max / 2, max] : [0, max]) {
    const line = el("div", "gridline");
    line.style.bottom = `${(tick / max) * 100}%`;
    line.append(el("span", "tick", number.format(tick)));
    plot.append(line);
  }

  const columns = el("div", "columns");
  const axis = el("div", "x-axis");
  const tooltip = el("div", "tooltip");
  tooltip.hidden = true;
  const labelled = new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1]);

  rows.forEach((row, i) => {
    const column = el("div", "column");
    column.tabIndex = 0;
    column.setAttribute("aria-label", `${formatLongDay(row.day)}: ${series.map((s) => `${row[s.key]} ${s.label.toLowerCase()}`).join(", ")}`);
    const stack = el("div", "stack");
    stack.style.height = `${(totals[i] / max) * 100}%`;
    for (const { key, color } of series) {
      if (!row[key]) continue;
      const segment = el("div", "segment");
      segment.style.flex = `${row[key]} 1 0`;
      segment.style.background = color;
      stack.append(segment);
    }
    column.append(stack);

    const show = () => {
      tooltip.replaceChildren(el("p", "tooltip-title", formatLongDay(row.day)), ...series.map((s) => tooltipRow(s, row[s.key])));
      tooltip.hidden = false;
      const box = container.getBoundingClientRect();
      const rect = column.getBoundingClientRect();
      const half = tooltip.offsetWidth / 2;
      tooltip.style.left = `${Math.min(Math.max(rect.left - box.left + rect.width / 2, half), box.width - half)}px`;
      container.classList.add("is-active");
      column.classList.add("active");
    };
    const hide = () => {
      tooltip.hidden = true;
      container.classList.remove("is-active");
      column.classList.remove("active");
    };
    column.addEventListener("pointerenter", show);
    column.addEventListener("focus", show);
    column.addEventListener("pointerleave", hide);
    column.addEventListener("blur", hide);
    columns.append(column);
    axis.append(el("span", "x-label", labelled.has(i) ? formatDay(row.day) : ""));
  });

  plot.append(columns);
  container.replaceChildren(plot, axis, tooltip);
}

/** Values lead, labels follow; a short line keys the series. */
function tooltipRow({ label, color }, value) {
  const row = el("div", "tooltip-row");
  const key = el("span", "line-key");
  key.style.background = color;
  row.append(key, el("strong", "", number.format(value)), el("span", "", label));
  return row;
}

/** Horizontal bars, one color, the value at each bar's tip. items: [{ label, value }] */
export function barList(list, items, color) {
  const max = Math.max(1, ...items.map(({ value }) => value));
  list.replaceChildren(
    ...items.map(({ label, value }) => {
      const bar = el("span", "bar");
      // Leave room for the value at the tip of the longest bar.
      bar.style.width = `calc((100% - 3rem) * ${value / max})`;
      bar.style.background = color;
      const track = el("span", "bar-track");
      track.append(bar, el("span", "bar-value", number.format(value)));
      const row = el("li", "bar-row");
      row.append(el("span", "bar-label", label), track);
      return row;
    }),
  );
}

export function emptyChart(container, text) {
  container.replaceChildren(el("p", "chart-empty", text));
}
