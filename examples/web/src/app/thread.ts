import type { Message } from "@relaykit/web";
import type { People } from "./people.js";
import { safe } from "./dom.js";
import { timeOf } from "./when.js";

/**
 * A thread: the message it hangs from, and everything said under it.
 *
 * Drawn apart from the timeline on purpose. The same message is in both, and what a thread shows is not what
 * a conversation shows — no day headings, no collapsing, because a thread is one exchange about one thing.
 */
export function paintThread(into: HTMLElement, messages: readonly Message[], people: People): void {
  const [root, ...answers] = messages;
  if (!root) {
    into.innerHTML = "";
    return;
  }
  const count = answers.length === 1 ? "1 respuesta" : `${answers.length} respuestas`;
  into.innerHTML = [
    said(root, people),
    `<p class="thread-count">${count}</p>`,
    ...answers.map(answer => said(answer, people))
  ].join("");
}

function said(message: Message, people: People): string {
  return `<div class="said">
    <span class="avatar big">${safe(people.initialsOf(message.senderId))}</span>
    <div>
      <p class="who">
        <strong>${safe(people.nameOf(message.senderId))}</strong>
        <span class="at">${timeOf(message.createdAt)}</span>
      </p>
      <p>${safe(message.body)}</p>
    </div>
  </div>`;
}
