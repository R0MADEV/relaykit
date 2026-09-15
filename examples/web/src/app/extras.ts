import type { ConversationId, MessageId, MessagingClient } from "@relaykit/web";
import { Asking } from "./asking.js";
import { Filing } from "./filing.js";
import { OtherWaysToSayIt } from "./other-ways-to-say-it.js";
import { Pinning } from "./pinning.js";
import { WhereYouAre } from "./where-you-are.js";
import type { People } from "./people.js";

/**
 * Everything the `⋯` menu does to the conversation being read.
 *
 * Together because they are one thing to whoever is looking at that menu, and because they all have the same
 * shape: they act on whatever is open, and they have to be repainted when that changes. Keeping them here
 * means the application above has one thing to build and one thing to tell, instead of five.
 */
export class Extras {
  private readonly filing: Filing;
  private readonly asking: Asking;
  private readonly pinning: Pinning;
  private readonly whereYouAre: WhereYouAre;
  private readonly otherWays: OtherWaysToSayIt;

  constructor(
    client: MessagingClient,
    people: People,
    around: {
      readonly openId: () => ConversationId | undefined;
      readonly leftItAll: () => void;
      readonly wentWrong: (error: unknown) => void;
    }
  ) {
    const { openId, wentWrong } = around;
    this.filing = new Filing(client, { leftItAll: around.leftItAll, wentWrong });
    this.asking = new Asking(client, { wentWrong });
    this.pinning = new Pinning(client, people, { openId, wentWrong });
    this.whereYouAre = new WhereYouAre(client, { wentWrong });
    this.otherWays = new OtherWaysToSayIt(client, { openId, wentWrong });
  }

  wire(): void {
    this.filing.wire();
    this.asking.wire();
    this.pinning.wire();
    this.whereYouAre.wire();
    this.otherWays.wire();
  }

  /** Said whenever what is open changes, including to nothing. */
  nowIn(conversationId: ConversationId | undefined): void {
    void this.filing.paintOn(conversationId);
    void this.asking.paintOn(conversationId);
    void this.pinning.paintOn(conversationId);
    this.whereYouAre.nowIn(conversationId);
  }

  pin(messageId: MessageId): void {
    void this.pinning.pin(messageId);
  }
}
