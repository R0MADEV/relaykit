import type { ConversationId } from "./models.js";

/** Where a link that invites somebody in points, as the protocol writes it. */
const linkToAConversation = /https:\/\/matrix\.to\/#\/([^\s<>"')]+)/;

/**
 * The conversation a message invites into, or nothing when it invites nowhere.
 *
 * A link to somebody rather than to somewhere — one starting with `@` — invites into no conversation and is
 * left alone. Everything else is taken as where it leads: what a conversation is called is the homeserver's
 * business, and requiring a shape here would be this library deciding that for it.
 */
export function conversationLinkedIn(body: string): ConversationId | undefined {
  const found = linkToAConversation.exec(body);
  if (!found?.[1]) return undefined;
  const where = decodeURIComponent(found[1]).split("?")[0] ?? "";
  const leadsToSomebody = where.startsWith("@");
  return where && !leadsToSomebody ? where : undefined;
}
