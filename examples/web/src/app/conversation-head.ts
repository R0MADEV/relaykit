import type { Call, Conversation, UserId } from "@relaykit/web";
import { element, input } from "./dom.js";
import type { People } from "./people.js";
import { isBetweenTwo, titleOf } from "./sidebar.js";

/** What is written above a conversation: what it is called, what it is about, and what is going on in it. */
export function paintHead(
  conversation: Conversation,
  what: {
    readonly people: People;
    readonly me: UserId;
    /** A call going on here, and whether this side is already on it. */
    readonly going: Call | undefined;
    readonly onIt: boolean;
  }
): void {
  const name = titleOf(conversation);
  const person = isBetweenTwo(conversation);
  // A heading is read on its own and gets the space; a placeholder is read as one word and does not.
  element("open-title").textContent = person ? name : `# ${name}`;
  element("open-topic").textContent = conversation.topic ?? "";
  // The identifier is not an address anybody can use, so a conversation without an alias says nothing.
  element("open-address").textContent = conversation.alias ?? "";
  const people = element("open-people");
  people.innerHTML = `<span aria-hidden="true">◍</span> ${conversation.participantIds.length}`;
  people.hidden = false;
  element("foot").textContent = conversation.isEncrypted
    ? "Matrix · cifrado extremo a extremo"
    : "Matrix · sin cifrar";
  input("write").placeholder = `Escribe en ${person ? name : `#${name}`}…`;
  // A conversation you were asked into is not one you are in: nothing arrives until you say yes.
  element("invited").hidden = conversation.membership !== "invite";
  // A call to join, which is only worth offering to somebody who is not already on it.
  element("room-banner").hidden = !what.going || what.onIt;
  element("room-banner-who").textContent = `${what.going?.participants.length ?? 0} participantes`;
}
