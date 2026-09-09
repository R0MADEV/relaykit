import { MatrixEvent, type Room } from "matrix-js-sdk";
import type { AdapterHandlers, Reaction } from "@relaykit/core";
import { mapReaction } from "./matrix-mapper.js";

export class ReactionTracker {
  private readonly reactions = new Map<string, Reaction>();

  track(event: MatrixEvent): void {
    const reaction = mapReaction(event);
    if (reaction) {
      this.reactions.set(reaction.id, reaction);
    }
  }

  remove(event: MatrixEvent, room: Room | undefined, handlers: AdapterHandlers): boolean {
    const reactionId = event.event.redacts;
    if (!reactionId || !room) {
      return false;
    }
    const reaction = this.reactions.get(reactionId);
    if (!reaction) {
      return false;
    }
    this.reactions.delete(reactionId);
    handlers.onReactionRemoved?.(reaction);
    return true;
  }

  clear(): void {
    this.reactions.clear();
  }
}
