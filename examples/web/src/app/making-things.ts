import type { ConversationId, MessagingClient, UserId } from "@relaykit/web";
import { dialog, element, input } from "./dom.js";
import type { People } from "./people.js";
import { PickingPeople } from "./picking-people.js";

/** The three things the `+` makes: a channel, an invitation, and a chat with somebody. */
export class MakingThings {
  private readonly picking = new Map<string, PickingPeople>();

  constructor(
    private readonly client: MessagingClient,
    people: People,
    private readonly here: {
      /** Where an invitation is for: whatever is open when it is sent. */
      readonly openId: () => ConversationId | undefined;
      readonly opened: (conversationId: ConversationId) => void;
      readonly wentWrong: (error: unknown) => void;
    }
  ) {
    for (const which of ["create-channel", "invite", "new-message"]) {
      const named = which === "create-channel" ? "create" : which;
      this.picking.set(which, new PickingPeople(named, client, people, () => this.countInvitations()));
      // What was typed is read as it is submitted, not once the dialog has closed: a `method="dialog"` form
      // resets itself on the way out, so by then the boxes are empty and the radios are back to their
      // defaults. What is read here is what somebody actually filled in.
      dialog(which).addEventListener("submit", () => this.whatWasFilledIn(which));
      dialog(which).addEventListener("close", () => void this.closed(which));
    }
  }

  /** Opened again is opened fresh, so nobody sends yesterday's invitation by pressing the same button twice. */
  open(which: string): void {
    this.picking.get(which)?.start();
    dialog(which).showModal();
  }

  private countInvitations(): void {
    const many = this.picking.get("invite")?.chosen().length ?? 0;
    element("invite-count").textContent = many === 1 ? "1 invitación" : `${many} invitaciones`;
  }

  /** Kept from the moment of submitting, because the form is empty by the time it has closed. */
  private filledIn: { readonly title: string; readonly open: boolean } = { title: "", open: true };

  private whatWasFilledIn(which: string): void {
    if (which !== "create-channel") return;
    const visibility = document.querySelector('input[name="visibility"]:checked');
    this.filledIn = {
      title: input("channel-name").value.trim(),
      open: visibility instanceof HTMLInputElement && visibility.value === "public"
    };
  }

  private async closed(which: string): Promise<void> {
    const chose = dialog(which).returnValue;
    const chosen = this.picking.get(which)?.chosen() ?? [];
    if (chose === "create") return this.createChannel(chosen);
    if (chose === "invite") return this.invite(chosen);
    if (chose === "start") return this.startTalkingTo(chosen);
  }

  /** A public channel anybody can walk into, or a private one that is encrypted because only the invited read it. */
  private async createChannel(participantIds: readonly UserId[]): Promise<void> {
    const { title, open } = this.filledIn;
    if (!title) return;
    const made = await this.client.conversations
      .create({ title, participantIds, public: open, encrypted: !open })
      .catch(this.here.wentWrong);
    input("channel-name").value = "";
    if (made) this.here.opened(made.id);
  }

  /** Invited, and told: the link travels as a message, so it is an invitation any other client can open too. */
  private async invite(userIds: readonly UserId[]): Promise<void> {
    const conversationId = this.here.openId();
    if (!conversationId || userIds.length === 0) return;
    for (const userId of userIds) {
      await this.client.conversations.invite(conversationId, userId).catch(this.here.wentWrong);
    }
    const link = await this.client.conversations.link(conversationId).catch(() => "");
    if (link) await this.client.messages.send(conversationId, link).catch(this.here.wentWrong);
  }

  /** One person is a direct chat the homeserver already knows about; several is a new one with no name. */
  private async startTalkingTo(userIds: readonly UserId[]): Promise<void> {
    const [first] = userIds;
    if (!first) return;
    const started =
      userIds.length === 1
        ? await this.client.conversations.open(first).catch(this.here.wentWrong)
        : await this.client.conversations
            .create({ participantIds: userIds, direct: true, encrypted: true })
            .catch(this.here.wentWrong);
    if (started) this.here.opened(started.id);
  }
}
