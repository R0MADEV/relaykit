import type { ConversationId, MessagingClient } from "@relaykit/web";
import { dialog, element, input, onClick, onSubmit } from "./dom.js";

/**
 * Where somebody is: a place sent once, or where they are for a while.
 *
 * Two different things and worth keeping apart. A place is a message like any other and stays where it was
 * said. Telling people where you are as you move is something that has to end, and what makes it safe is
 * that it ends on its own: the duration is not optional, so a browser closed mid-walk stops telling anyway.
 */
export class WhereYouAre {
  private conversationId: ConversationId | undefined;
  private sharingId: string | undefined;
  private tellingAgain: number | undefined;

  constructor(
    private readonly client: MessagingClient,
    private readonly around: { readonly wentWrong: (error: unknown) => void }
  ) {}

  wire(): void {
    onClick("send-a-place", () => this.openThePlace());
    onSubmit("place-form", () => void this.sendThePlace());
    onClick("share-where-i-am", () => void this.shareOrStop());
  }

  nowIn(conversationId: ConversationId | undefined): void {
    this.conversationId = conversationId;
  }

  private openThePlace(): void {
    element("more-menu").hidden = true;
    if (!this.conversationId) return;
    input("place-what").value = "";
    input("place-where").value = "43.263, -2.935";
    dialog("place").showModal();
  }

  /** Two numbers and a name. Anything else is not a place, and is refused before the homeserver sees it. */
  private async sendThePlace(): Promise<void> {
    const conversationId = this.conversationId;
    const [latitude, longitude] = input("place-where")
      .value.split(",")
      .map(part => Number(part.trim()));
    const description = input("place-what").value.trim();
    const isAPlace =
      latitude !== undefined &&
      longitude !== undefined &&
      Number.isFinite(latitude) &&
      Number.isFinite(longitude);
    if (!conversationId || !isAPlace) return;
    try {
      await this.client.messages.sendLocation(conversationId, {
        latitude,
        longitude,
        ...(description ? { description } : {})
      });
    } catch (error) {
      this.around.wentWrong(error);
    }
  }

  private async shareOrStop(): Promise<void> {
    element("more-menu").hidden = true;
    if (this.sharingId) return void this.stop();
    const conversationId = this.conversationId;
    if (!conversationId) return;
    try {
      const sharing = await this.client.location.start(conversationId, {
        durationMs: tenMinutes,
        description: "voy para allá"
      });
      this.sharingId = sharing.id;
      this.showSharing(true);
      this.tellWhereIAm();
      // Told again while it lasts, because a position from ten minutes ago is not where somebody is.
      this.tellingAgain = window.setInterval(() => this.tellWhereIAm(), 30_000);
    } catch (error) {
      this.around.wentWrong(error);
    }
  }

  private async stop(): Promise<void> {
    const sharingId = this.sharingId;
    this.sharingId = undefined;
    window.clearInterval(this.tellingAgain);
    this.showSharing(false);
    if (sharingId) await this.client.location.stop(sharingId).catch(this.around.wentWrong);
  }

  private showSharing(going: boolean): void {
    element("share-where-i-am").textContent = going
      ? "⦿ Dejar de compartir dónde estoy"
      : "⦿ Compartir dónde estoy";
  }

  /**
   * Asking the browser where this is, and saying so.
   *
   * No permission means no position, and that is an answer rather than a failure: nothing is told, and the
   * sharing goes on saying nothing until it runs out on its own.
   */
  private tellWhereIAm(): void {
    const sharingId = this.sharingId;
    if (!sharingId || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      position =>
        void this.client.location
          .update(sharingId, {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          })
          .catch(this.around.wentWrong),
      () => undefined
    );
  }
}

/** Long enough to walk somewhere, short enough that forgetting about it costs nothing. */
const tenMinutes = 10 * 60 * 1000;
