import type { Reaction, UserId } from "@relaykit/web";

/** One key on one message, however many people left it, and this person's own if they left one. */
export interface Pill {
  readonly key: string;
  readonly count: number;
  /** The identifier of this person's own reaction with this key, so pressing the pill can take it back. */
  readonly mine: string | undefined;
}

/**
 * The reactions on a message, as they are drawn: one pill per key.
 *
 * Knowing which one is yours is what makes a pill a button rather than a label — pressing it takes yours back
 * instead of leaving a second one nobody can tell from the first.
 */
export function grouped(reactions: readonly Reaction[] | undefined, me: UserId): readonly Pill[] {
  const pills = new Map<string, { count: number; mine: string | undefined }>();
  for (const reaction of reactions ?? []) {
    const already = pills.get(reaction.key) ?? { count: 0, mine: undefined };
    pills.set(reaction.key, {
      count: already.count + 1,
      mine: reaction.senderId === me ? reaction.id : already.mine
    });
  }
  return [...pills].map(([key, { count, mine }]) => ({ key, count, mine }));
}
