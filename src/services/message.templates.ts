import {
  dayDiff,
  hasExplicitTime,
  localDate,
  localTime,
  weekdayIndex,
  zonedParts,
} from "./zoned-date";

type Priority = "LOW" | "MEDIUM" | "HIGH";

export interface TemplateTask {
  title: string;
  dueDate: Date | null;
  priority: Priority;
  category: { name: string } | null;
}

export interface BuiltMessage {
  subject: string;
  text: string;
  html: string;
  telegram: string;
}

interface SummaryInput {
  name: string | null;
  tasks: TemplateTask[];
  timeZone: string;
  appUrl?: string;
  now?: Date;
}

// Links de un solo uso para resolver la tarea desde el email (en Telegram van como botones).
export interface ReminderActions {
  done: string;
  tomorrow: string;
  dismiss: string;
}

interface ReminderInput {
  name: string | null;
  task: TemplateTask;
  timeZone: string;
  appUrl?: string;
  actions?: ReminderActions;
  now?: Date;
}

interface Groups {
  today: TemplateTask[];
  upcoming: TemplateTask[];
  noDate: TemplateTask[];
  extra: number;
}

const MAX_UPCOMING = 5;
const MAX_NO_DATE = 3;

const WEEKDAY_LONG = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const WEEKDAY_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const PRIORITY_ICON: Record<Priority, string> = { HIGH: "🔴", MEDIUM: "🟡", LOW: "🟢" };
const PRIORITY_COLOR: Record<Priority, string> = { HIGH: "#FF8B66", MEDIUM: "#F2C14E", LOW: "#B8A4E3" };
const PRIORITY_RANK: Record<Priority, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

const CATEGORY_BG: Record<string, string> = {
  Finanzas: "#FFE1D3",
  Trabajo: "#EBE4F7",
  Salud: "#F7D9D9",
  Hogar: "#FBEDC9",
  Personal: "#DDEFD6",
  Otros: "#E1EBDC",
};

const C = {
  bg: "#EDF3EA",
  paper: "#FBFCF9",
  ink: "#202322",
  soft: "#5D6561",
  coral: "#FF8B66",
  coralSoft: "#FFE1D3",
};

const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";

const esc = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const identity = (value: string) => value;

// Telegram rechaza links a localhost: solo mostramos el link si la URL es pública.
const isPublicUrl = (url: string) => !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url);

function firstName(name: string | null) {
  return name?.trim().split(/\s+/)[0] || null;
}

function dayPart(now: Date, timeZone: string) {
  const { hour } = zonedParts(now, timeZone);
  if (hour < 12) return { greeting: "Buen día", emoji: "☀️" };
  if (hour < 20) return { greeting: "Buenas tardes", emoji: "🌤️" };
  return { greeting: "Buenas noches", emoji: "🌙" };
}

function longDate(now: Date, timeZone: string) {
  const { month, day } = zonedParts(now, timeZone);
  const weekday = WEEKDAY_LONG[weekdayIndex(now, timeZone)];
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${day} de ${MONTHS[month - 1]}`;
}

function formatWhen(date: Date, now: Date, timeZone: string) {
  const diff = dayDiff(date, now, timeZone);
  const time = hasExplicitTime(date, timeZone) ? localTime(date, timeZone) : null;

  if (diff === 0) return time ?? "todo el día";
  if (diff === -1) return time ? `ayer ${time}` : "ayer";
  if (diff === 1) return time ? `mañana ${time}` : "mañana";

  const { day, month } = zonedParts(date, timeZone);
  const label = `${WEEKDAY_SHORT[weekdayIndex(date, timeZone)]} ${day}/${month}`;
  return time ? `${label} · ${time}` : label;
}

function groupTasks(tasks: TemplateTask[], now: Date, timeZone: string): Groups {
  const today = localDate(now, timeZone);

  const todayTasks: TemplateTask[] = [];
  const upcoming: TemplateTask[] = [];
  const noDate: TemplateTask[] = [];

  for (const task of tasks) {
    if (!task.dueDate) noDate.push(task);
    else if (localDate(task.dueDate, timeZone) <= today) todayTasks.push(task);
    else upcoming.push(task);
  }

  const byDate = (a: TemplateTask, b: TemplateTask) => a.dueDate!.getTime() - b.dueDate!.getTime();
  const byPriority = (a: TemplateTask, b: TemplateTask) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];

  todayTasks.sort((a, b) => byDate(a, b) || byPriority(a, b));
  upcoming.sort(byDate);
  noDate.sort(byPriority);

  const extra =
    Math.max(0, upcoming.length - MAX_UPCOMING) + Math.max(0, noDate.length - MAX_NO_DATE);

  return {
    today: todayTasks,
    upcoming: upcoming.slice(0, MAX_UPCOMING),
    noDate: noDate.slice(0, MAX_NO_DATE),
    extra,
  };
}

function buildLead(
  groups: Groups,
  bold: (value: string) => string,
  escape: (value: string) => string,
) {
  const { today, upcoming, noDate } = groups;

  if (today.length === 0) {
    return upcoming.length + noDate.length > 0
      ? "Hoy no tenés nada con fecha. Esto es lo que viene:"
      : "No tenés nada pendiente. Buen momento para contarle algo nuevo a Che.";
  }

  const top = today.find((task) => task.priority === "HIGH") ?? today[0];
  const count = today.length;
  return `Tenés ${bold(`${count} ${count === 1 ? "cosa" : "cosas"}`)} para hoy. La más urgente: ${bold(escape(top.title))}.`;
}

function summarySubject(groups: Groups) {
  const count = groups.today.length;
  return count > 0
    ? `☀️ Tu día en Che: ${count} ${count === 1 ? "cosa" : "cosas"} para hoy`
    : "Tu resumen de Che";
}

// ---------- Telegram (parse_mode HTML) ----------

function telegramLine(task: TemplateTask, now: Date, timeZone: string) {
  const parts = [`${PRIORITY_ICON[task.priority]} <b>${esc(task.title)}</b>`];
  if (task.dueDate) parts.push(esc(formatWhen(task.dueDate, now, timeZone)));
  if (task.category) parts.push(`<i>${esc(task.category.name)}</i>`);
  return parts.join(" · ");
}

function telegramSummary(input: SummaryInput, groups: Groups, now: Date) {
  const { timeZone } = input;
  const { greeting, emoji } = dayPart(now, timeZone);
  const name = firstName(input.name);
  const line = (task: TemplateTask) => telegramLine(task, now, timeZone);

  const lines: string[] = [
    `${emoji} <b>${esc(greeting)}${name ? `, ${esc(name)}` : ""}</b>`,
    `<i>${esc(longDate(now, timeZone))}</i>`,
    "",
    buildLead(groups, (value) => `<b>${value}</b>`, esc),
  ];

  if (groups.today.length) lines.push("", "<b>📌 Hoy</b>", ...groups.today.map(line));
  if (groups.upcoming.length) lines.push("", "<b>🗓 Más adelante</b>", ...groups.upcoming.map(line));
  if (groups.noDate.length) lines.push("", "<b>📝 Sin fecha</b>", ...groups.noDate.map(line));
  if (groups.extra > 0) lines.push("", `<i>y ${groups.extra} más en la app</i>`);
  if (input.appUrl && isPublicUrl(input.appUrl)) {
    lines.push("", `<a href="${esc(input.appUrl)}">Abrir Che</a>`);
  }

  return lines.join("\n");
}

// ---------- Texto plano (respaldo del email) ----------

function plainLine(task: TemplateTask, now: Date, timeZone: string) {
  const when = task.dueDate ? ` — ${formatWhen(task.dueDate, now, timeZone)}` : "";
  const category = task.category ? ` (${task.category.name})` : "";
  return `${PRIORITY_ICON[task.priority]} ${task.title}${when}${category}`;
}

function plainSummary(input: SummaryInput, groups: Groups, now: Date) {
  const { timeZone } = input;
  const { greeting } = dayPart(now, timeZone);
  const name = firstName(input.name);
  const line = (task: TemplateTask) => plainLine(task, now, timeZone);

  const lines: string[] = [
    `${greeting}${name ? `, ${name}` : ""}`,
    longDate(now, timeZone),
    "",
    buildLead(groups, identity, identity),
  ];

  if (groups.today.length) lines.push("", "HOY", ...groups.today.map(line));
  if (groups.upcoming.length) lines.push("", "MÁS ADELANTE", ...groups.upcoming.map(line));
  if (groups.noDate.length) lines.push("", "SIN FECHA", ...groups.noDate.map(line));
  if (groups.extra > 0) lines.push("", `y ${groups.extra} más en la app`);
  if (input.appUrl) lines.push("", `Abrir Che: ${input.appUrl}`);

  return lines.join("\n");
}

// ---------- Email (HTML) ----------

function emailRow(task: TemplateTask, now: Date, timeZone: string) {
  const when = task.dueDate ? esc(formatWhen(task.dueDate, now, timeZone)) : "";
  const category = task.category
    ? `<span style="display:inline-block;background:${CATEGORY_BG[task.category.name] ?? "#E1EBDC"};border:1px solid ${C.ink};border-radius:999px;padding:1px 9px;font-size:11px;font-weight:bold;color:${C.ink};">${esc(task.category.name)}</span>`
    : "";
  const separator = when && category ? " &nbsp;·&nbsp; " : "";

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px;border:1px solid ${C.ink};border-left:5px solid ${PRIORITY_COLOR[task.priority]};border-radius:12px;background:#FFFFFF;">
<tr><td style="padding:12px 14px;font-family:${SANS};">
<div style="font-size:15px;font-weight:bold;line-height:1.3;color:${C.ink};">${esc(task.title)}</div>
<div style="margin-top:6px;font-size:12px;color:${C.soft};">${when}${separator}${category}</div>
</td></tr>
</table>`;
}

const sectionLabel = (label: string) =>
  `<div style="margin:24px 0 10px;font-family:${SANS};font-size:11px;font-weight:bold;letter-spacing:1.2px;text-transform:uppercase;color:${C.soft};">${esc(label)}</div>`;

function emailShell(preheader: string, inner: string, appUrl?: string) {
  const cta = appUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr><td style="background:${C.ink};border-radius:12px;"><a href="${esc(appUrl)}" style="display:inline-block;padding:13px 22px;font-family:${SANS};font-size:14px;font-weight:bold;color:${C.bg};text-decoration:none;">Abrir Che →</a></td></tr></table>`
    : "";

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>Che</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr><td style="padding:0 4px 14px;font-family:${SERIF};font-size:28px;font-weight:bold;color:${C.ink};">Che<span style="color:${C.coral};font-style:italic;">.</span></td></tr>
<tr><td style="background:${C.paper};border:2px solid ${C.ink};border-radius:20px;padding:28px 26px;box-shadow:6px 6px 0 ${C.coralSoft};font-family:${SANS};color:${C.ink};">
${inner}
${cta}
</td></tr>
<tr><td style="padding:18px 6px 0;font-family:${SANS};font-size:12px;line-height:1.5;color:${C.soft};">Recibís este mensaje porque tenés avisos activados en Che. Podés cambiar el canal desde tu perfil.</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function emailSummary(input: SummaryInput, groups: Groups, now: Date) {
  const { timeZone } = input;
  const { greeting, emoji } = dayPart(now, timeZone);
  const name = firstName(input.name);
  const lead = buildLead(groups, (value) => `<strong>${value}</strong>`, esc);
  const preheader = buildLead(groups, identity, identity);

  const section = (label: string, tasks: TemplateTask[]) =>
    tasks.length ? sectionLabel(label) + tasks.map((task) => emailRow(task, now, timeZone)).join("\n") : "";

  const inner = [
    `<div style="font-size:12px;font-weight:bold;letter-spacing:1.2px;text-transform:uppercase;color:${C.soft};">${esc(longDate(now, timeZone))}</div>`,
    `<h1 style="margin:8px 0 10px;font-family:${SERIF};font-size:30px;line-height:1.15;color:${C.ink};">${esc(greeting)}${name ? `, ${esc(name)}` : ""} ${emoji}</h1>`,
    `<p style="margin:0;font-size:16px;line-height:1.55;color:${C.ink};">${lead}</p>`,
    section("Hoy", groups.today),
    section("Más adelante", groups.upcoming),
    section("Sin fecha", groups.noDate),
    groups.extra > 0
      ? `<p style="margin:6px 0 0;font-size:13px;color:${C.soft};">y ${groups.extra} más en la app</p>`
      : "",
  ].join("\n");

  return emailShell(preheader, inner, input.appUrl);
}

function emailActions(actions: ReminderActions) {
  const button = (label: string, url: string, primary: boolean) =>
    `<td style="padding:0 8px 8px 0;"><a href="${esc(url)}" style="display:inline-block;padding:10px 14px;border:1.5px solid ${C.ink};border-radius:10px;background:${primary ? C.ink : C.paper};font-family:${SANS};font-size:13px;font-weight:bold;color:${primary ? C.bg : C.ink};text-decoration:none;">${esc(label)}</a></td>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:6px;"><tr>
${button("✓ Hecho", actions.done, true)}
${button("→ Mañana", actions.tomorrow, false)}
${button("× Ya no me interesa", actions.dismiss, false)}
</tr></table>`;
}

// ---------- API pública ----------

export function buildDailySummaryMessage(input: SummaryInput): BuiltMessage {
  const now = input.now ?? new Date();
  const groups = groupTasks(input.tasks, now, input.timeZone);

  return {
    subject: summarySubject(groups),
    text: plainSummary(input, groups, now),
    html: emailSummary(input, groups, now),
    telegram: telegramSummary(input, groups, now),
  };
}

export function buildTaskReminderMessage(input: ReminderInput): BuiltMessage {
  const now = input.now ?? new Date();
  const { task, timeZone } = input;
  const name = firstName(input.name);
  const intro = `${name ? `${name}, ` : ""}esto vence pronto:`;
  const capitalized = intro.charAt(0).toUpperCase() + intro.slice(1);

  const telegram = [
    "⏰ <b>Recordatorio</b>",
    "",
    esc(capitalized),
    telegramLine(task, now, timeZone),
    ...(input.appUrl && isPublicUrl(input.appUrl) ? ["", `<a href="${esc(input.appUrl)}">Abrir Che</a>`] : []),
  ].join("\n");

  const text = [
    "⏰ Recordatorio",
    "",
    capitalized,
    plainLine(task, now, timeZone),
    ...(input.actions
      ? ["", `✓ Hecho: ${input.actions.done}`, `→ Mañana: ${input.actions.tomorrow}`, `× Ya no me interesa: ${input.actions.dismiss}`]
      : []),
    ...(input.appUrl ? ["", `Abrir Che: ${input.appUrl}`] : []),
  ].join("\n");

  const inner = [
    `<div style="font-size:12px;font-weight:bold;letter-spacing:1.2px;text-transform:uppercase;color:${C.soft};">⏰ Recordatorio</div>`,
    `<h1 style="margin:8px 0 18px;font-family:${SERIF};font-size:26px;line-height:1.2;color:${C.ink};">${esc(capitalized)}</h1>`,
    emailRow(task, now, timeZone),
    input.actions ? emailActions(input.actions) : "",
  ].join("\n");

  return {
    subject: `⏰ Recordatorio: ${task.title}`,
    text,
    html: emailShell(capitalized, inner, input.appUrl),
    telegram,
  };
}
