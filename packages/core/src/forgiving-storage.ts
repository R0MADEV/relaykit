import type { MessagingStorage } from "./storage.js";

/**
 * The local copy is a convenience, not the truth: the truth is on the homeserver. A browser that runs out of
 * room, a private window, a revoked quota or a disk that refuses to write must cost somebody the convenience,
 * never the conversation. Without this, a failure to keep a copy of a message is thrown at whoever only wanted
 * to read the conversation, and the chat stops working because there is nowhere to cache it.
 *
 * So every call is let through, and a failure is reported once to whoever is listening rather than thrown:
 *
 *  - Keeping something that could not be kept carries on. What was not written is fetched again next time.
 *  - Reading something that cannot be read answers as if there were nothing there, which sends the caller to
 *    the homeserver, which is where the answer really is.
 *
 * The outbox is the one part that is not a copy: a message that could not be written down will not survive the
 * application being closed. It still goes out now, and the failure is reported, because refusing to send it
 * would lose it sooner and for certain.
 */
export function forgivingStorage(
  storage: MessagingStorage,
  report: (error: unknown) => void
): MessagingStorage {
  const nothingFor = new Map<keyof MessagingStorage, unknown>([
    ["getConversations", []],
    ["getMessages", []],
    ["getPendingMessages", []],
    ["getReadyOutbox", []],
    ["getProfiles", []],
    ["getMessage", undefined],
    ["getOutboxOperation", undefined],
    ["getDraft", undefined]
  ]);

  return new Proxy(storage, {
    get(target, name: string & keyof MessagingStorage) {
      const original = target[name];
      if (typeof original !== "function") return original;
      return async (...args: unknown[]) => {
        try {
          return await (original as (...rest: unknown[]) => Promise<unknown>).apply(target, args);
        } catch (error) {
          report(error);
          // Something that could not be read is answered as empty, so the caller asks the homeserver instead.
          // Something that could not be written is let go: it will be written again, or fetched again.
          return nothingFor.get(name);
        }
      };
    }
  });
}
