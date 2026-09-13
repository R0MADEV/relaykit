import type { Message, MessageId, PastCall, UserId } from "@relaykit/web";
import type { People } from "./people.js";
import { safe } from "./dom.js";
import { dayOf, lastedFor, timeOf } from "./when.js";

/** Everything a conversation puts on screen in the order it happened: what was said, and the calls that are over. */
export type Entry =
  | { readonly kind: "message"; readonly at: number; readonly message: Message }
  | { readonly kind: "call"; readonly at: number; readonly call: PastCall };

export interface Reading {
  readonly people: People;
  /** How many answers hang off each message, so a thread can be opened without counting them again. */
  readonly threads: ReadonlyMap<MessageId, number>;
}

/** What was said and what happened, in one stream, with a heading between one day and the next. */
export function paintTimeline(into: HTMLElement, entries: readonly Entry[], reading: Reading): void {
  let lastDay = "";
  let lastSaidBy: UserId | undefined;
  const drawn: string[] = [];
  for (const entry of entries) {
    const day = dayOf(entry.at);
    if (day !== lastDay) {
      drawn.push(`<p class="day">${safe(day)}</p>`);
      lastDay = day;
      lastSaidBy = undefined;
    }
    if (entry.kind === "call") {
      drawn.push(callOver(entry.call, reading.people));
      lastSaidBy = undefined;
      continue;
    }
    // Somebody saying three things in a row is one person talking, not three people: the face and the name go
    // on the first line only, the way anybody reading would expect.
    const sameVoice = entry.message.senderId === lastSaidBy;
    drawn.push(sameVoice ? saidAgain(entry.message, reading) : said(entry.message, reading));
    lastSaidBy = entry.message.senderId;
  }
  into.innerHTML = drawn.join("");
}

function said(message: Message, reading: Reading): string {
  const who = reading.people.nameOf(message.senderId);
  return `<div class="said">
    <span class="avatar big">${safe(reading.people.initialsOf(message.senderId))}</span>
    <div>
      <p class="who"><strong>${safe(who)}</strong><span class="at">${timeOf(message.createdAt)}</span></p>
      ${body(message)}${reactions(message)}${thread(message, reading)}
    </div>
  </div>`;
}

function saidAgain(message: Message, reading: Reading): string {
  return `<div class="said same"><span class="at">${timeOf(message.createdAt)}</span>
    <div>${body(message)}${reactions(message)}${thread(message, reading)}</div>
  </div>`;
}

/** What the message is. A link to a conversation is an invitation, and reads as a way in rather than as text. */
function body(message: Message): string {
  if (message.deletedAt) return `<p class="gone">Mensaje borrado</p>`;
  if (message.undecryptable) return `<p class="gone">No se puede leer: falta la clave</p>`;
  if (message.invitesTo) return invitation(message);
  const attachment = message.attachment ? `<p class="file">📎 ${safe(message.attachment.name)}</p>` : "";
  const edited = message.editedAt ? ` <span class="faint">(editado)</span>` : "";
  const sending = message.status === "sending" ? ' data-sending="true"' : "";
  return `<p${sending}>${safe(message.body)}${edited}</p>${attachment}`;
}

function invitation(message: Message): string {
  return `<div class="card invite-card">
    <span class="card-icon" aria-hidden="true">▭</span>
    <div>
      <p class="label">Invitación a sala</p>
      <strong>${safe(message.body)}</strong>
    </div>
    <div class="spacer"></div>
    <button class="button accent" data-enters="${safe(message.invitesTo ?? "")}">Entrar</button>
  </div>`;
}

/** The same key left by several people is one pill with a number, which is what everybody draws. */
function reactions(message: Message): string {
  const left = message.reactions ?? [];
  if (left.length === 0) return "";
  const counted = new Map<string, number>();
  for (const reaction of left) counted.set(reaction.key, (counted.get(reaction.key) ?? 0) + 1);
  const pills = [...counted]
    .map(
      ([key, count]) =>
        `<button class="reaction" data-reacts="${safe(message.id)}" data-key="${safe(key)}">${safe(key)} ${count}</button>`
    )
    .join("");
  return `<div class="reactions">${pills}</div>`;
}

function thread(message: Message, reading: Reading): string {
  const answers = reading.threads.get(message.id) ?? 0;
  if (answers === 0) return "";
  const many = answers === 1 ? "1 respuesta" : `${answers} respuestas`;
  return `<button class="in-thread" data-opens-thread="${safe(message.id)}">↩ ${many} en hilo</button>`;
}

/**
 * A call that is over. One name on it means nobody else ever came, and a room nobody joined is worth saying
 * so out loud rather than showing as a conference of one.
 */
function callOver(call: PastCall, people: People): string {
  const alone = call.participantIds.length <= 1;
  const heading = alone ? "Sala caducada" : "Conferencia finalizada";
  const under = alone
    ? "Nadie entró · la sala se cerró sola"
    : `${call.participantIds.length} participantes · ${lastedFor(call.endedAt - call.startedAt)}`;
  const names = call.participantIds.map(userId => people.nameOf(userId)).join(", ");
  return `<div class="said">
    <div class="card over-card">
      <span class="card-icon" aria-hidden="true">${alone ? "▭" : "◷"}</span>
      <div>
        <p class="label">${heading}</p>
        <strong>${safe(names || "Sala")}</strong>
        <p class="mono faint">${safe(under)}</p>
      </div>
    </div>
  </div>`;
}
