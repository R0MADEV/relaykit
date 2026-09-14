import type { ConversationId, Notification } from "@relaykit/web";

/**
 * Whether something that arrived is worth interrupting somebody about.
 *
 * What deserves attention at all is the library's decision — it is what a notification is. What is left is
 * whether this person is already looking at it: a message arriving in the conversation on screen, with the
 * window in front, has already been delivered by being drawn. Being named is the exception, because somebody
 * reading three conversations up still has to know.
 */
export function worthInterrupting(
  arrived: Notification,
  here: { readonly openId: ConversationId | undefined; readonly looking: boolean }
): boolean {
  if (arrived.isMention) return true;
  const alreadyOnScreen = here.looking && arrived.conversationId === here.openId;
  return !alreadyOnScreen;
}

/** More waiting than anybody counts one by one. */
const asManyAsAnybodyCounts = 99;

/** What the tab says: how much is waiting, so it is legible from another tab and from the dock. */
export function titleWith(waiting: number): string {
  if (waiting <= 0) return "Deitu";
  const said = waiting > asManyAsAnybodyCounts ? `${asManyAsAnybodyCounts}+` : String(waiting);
  return `(${said}) Deitu`;
}

/**
 * Telling somebody about it outside the page: a system notification, and the tab saying how much is waiting.
 *
 * Permission is asked for the first time there is something worth saying, rather than on the way in: nobody
 * grants it to an application they have not used yet, and asking once and being refused is asking for ever.
 */
export function tellAbout(arrived: Notification, who: string, open: () => void): void {
  if (typeof window.Notification === "undefined") return;
  if (window.Notification.permission === "default") {
    void window.Notification.requestPermission().then(() => tellAbout(arrived, who, open));
    return;
  }
  if (window.Notification.permission !== "granted") return;
  const said = new window.Notification(who, { body: arrived.body, tag: arrived.conversationId });
  said.onclick = () => {
    window.focus();
    open();
  };
}
