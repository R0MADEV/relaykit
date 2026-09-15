import type { Attachment, ConversationId, Message, MessageId, PastCall, UserId } from "@relaykit/web";
import { addressOf, kindOf } from "./attachments.js";
import { grouped } from "./reacting.js";
import { face, type People } from "./people.js";
import { safe } from "./dom.js";
import { dayOf, lastedFor, timeOf } from "./when.js";

/** Everything a conversation puts on screen in the order it happened: what was said, and the calls that are over. */
export type Entry =
  | { readonly kind: "message"; readonly at: number; readonly message: Message }
  | { readonly kind: "call"; readonly at: number; readonly call: PastCall };

export interface Reading {
  readonly people: People;
  /** Whose screen this is: what you can do to a message depends on whether you said it. */
  readonly me: UserId;
  /** How many answers hang off each message, so a thread can be opened without counting them again. */
  readonly threads: ReadonlyMap<MessageId, number>;
  /** What the conversation an invitation points at is called, when this account is already in it. */
  readonly nameOf: (conversationId: ConversationId) => string | undefined;
  /** What a message being answered said, for the line drawn above the answer. */
  readonly answered: (messageId: MessageId) => string | undefined;
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
  return `<div class="said" data-message="${safe(message.id)}">${whatCanBeDone(message, reading)}
    ${face(reading.people, message.senderId, true)}
    <div>
      <p class="who"><strong>${safe(who)}</strong><span class="at">${timeOf(message.createdAt)}</span></p>
      ${body(message, reading)}${reactions(message, reading)}${thread(message, reading)}
    </div>
  </div>`;
}

function saidAgain(message: Message, reading: Reading): string {
  return `<div class="said same" data-message="${safe(message.id)}">${whatCanBeDone(message, reading)}<span class="at">${timeOf(message.createdAt)}</span>
    <div>${body(message, reading)}${reactions(message, reading)}${thread(message, reading)}</div>
  </div>`;
}

/** What the message is. A link to a conversation is an invitation, and reads as a way in rather than as text. */
function body(message: Message, reading: Reading): string {
  if (message.deletedAt) return `<p class="gone">Mensaje borrado</p>`;
  if (message.undecryptable) return `<p class="gone">No se puede leer: falta la clave</p>`;
  if (message.invitesTo) return invitation(message, reading);
  const attachment = message.attachment ? drawn(message.attachment) : "";
  const edited = message.editedAt ? ` <span class="faint">(editado)</span>` : "";
  const answering = message.replyToId
    ? `<p class="answering">↩ <span>${safe(reading.answered(message.replyToId) ?? "un mensaje")}</span></p>`
    : "";
  const sending = message.status === "sending" ? ' data-sending="true"' : "";
  // A message that did not go out is not a message anybody sent: it says so, and offers the two ways on.
  const failed =
    message.status === "failed"
      ? `<p class="failed">No se pudo enviar
           <button data-retries="${safe(message.id)}">Reintentar</button>
           <button data-gives-up="${safe(message.id)}">Descartar</button>
         </p>`
      : "";
  return `${answering}<p${sending}>${safe(message.body)}${edited}</p>${failed}${attachment}`;
}

/**
 * An attachment as the thing it is: a picture shows, a film and a recording play, and anything else is a
 * name with a way to save it. Until it has arrived it is the name, which is what a screen can draw at once.
 */
function drawn(attachment: Attachment): string {
  const address = addressOf(attachment);
  const name = safe(attachment.name);
  if (!address) return `<p class="file">📎 ${name} <span class="faint">cargando…</span></p>`;
  const kind = kindOf(attachment.mimeType);
  if (kind === "picture") return `<img class="shown" src="${safe(address)}" alt="${name}" />`;
  if (kind === "film") return `<video class="shown" src="${safe(address)}" controls></video>`;
  if (kind === "recording") return `<audio src="${safe(address)}" controls></audio>`;
  return `<a class="file" href="${safe(address)}" download="${name}">📎 ${name}</a>`;
}

function invitation(message: Message, reading: Reading): string {
  const where = message.invitesTo ?? "";
  // The link is what travels; what it is called is only known once this account is in it. Until then the
  // card says what it is, because a matrix.to address is not a name anybody reads.
  const name = reading.nameOf(where) ?? "Una sala";
  return `<div class="card invite-card">
    <span class="card-icon" aria-hidden="true">▭</span>
    <div>
      <p class="label">Invitación a sala</p>
      <strong>${safe(name)}</strong>
    </div>
    <div class="spacer"></div>
    <button class="button accent" data-enters="${safe(where)}">Entrar</button>
  </div>`;
}

/** One pill per key, and the one that is yours says so: pressing it takes it back rather than adding another. */
function reactions(message: Message, reading: Reading): string {
  const pills = grouped(message.reactions, reading.me);
  const drawn = pills
    .map(
      pill =>
        `<button class="reaction"${pill.mine ? ' data-mine="true"' : ""} data-reacts="${safe(message.id)}"
          data-key="${safe(pill.key)}" data-takes-back="${safe(pill.mine ?? "")}">${safe(pill.key)} ${pill.count}</button>`
    )
    .join("");
  // The way to leave one in the first place, which is the same button whether or not there are any yet.
  const more = `<button class="reaction more" data-reacts-to="${safe(message.id)}" aria-label="Reaccionar">+</button>`;
  return `<div class="reactions">${drawn}${more}</div>`;
}

/** What can be done to a message: answer it, and where it is yours, change it or take it back. */
function whatCanBeDone(message: Message, reading: Reading): string {
  const mine = message.senderId === reading.me;
  const change = mine
    ? `<button data-edits="${safe(message.id)}" aria-label="Editar">✎</button>
       <button data-deletes="${safe(message.id)}" aria-label="Borrar">🗑</button>`
    : "";
  return `<div class="doings">
    <button data-answers="${safe(message.id)}" aria-label="Responder">↩</button>
    <button data-hangs-from="${safe(message.id)}" aria-label="Responder en hilo">💬</button>
    ${change}
  </div>`;
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
