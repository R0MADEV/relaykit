import type { AvatarImage, ConversationId, Conversation, MessagingClient } from "@relaykit/web";
import { dialog, element, input, onClick } from "./dom.js";

/**
 * What a conversation is called, what it is about, and the picture beside its name.
 *
 * Its own screen because all three are the same thing — what everybody else sees — and because changing any
 * of them can be refused: a conversation says who may rename it, and the refusal is worth showing where the
 * change was asked for rather than somewhere else.
 */
export class Settings {
  private about: Conversation | undefined;

  constructor(
    private readonly client: MessagingClient,
    private readonly where: {
      readonly openId: () => ConversationId | undefined;
      readonly conversations: () => readonly Conversation[];
    }
  ) {}

  wire(): void {
    onClick("settings-here", () => this.open());
    onClick("settings-picture", () => input("settings-file").click());
    onClick("settings-save", () => void this.save());
    // Applied as they are changed rather than on saving: none of the three is about what the conversation is
    // called, and making somebody press Save to silence something they are being interrupted by is cruel.
    whenChanged("settings-favourite", () => void this.setFavourite());
    whenChanged("settings-loudness", () => void this.setLoudness());
    whenChanged("settings-door", () => void this.setDoor());
    input("settings-file").addEventListener("change", () => void this.changePicture());
  }

  private open(): void {
    const conversationId = this.where.openId();
    this.about = this.where.conversations().find(each => each.id === conversationId);
    if (!this.about) return;
    element("more-menu").hidden = true;
    element("settings-wrong").hidden = true;
    input("settings-name").value = this.about.title ?? "";
    input("settings-topic").value = this.about.topic ?? "";
    input("settings-favourite").checked = this.about.isFavourite === true;
    picker("settings-loudness").value = this.about.notifications ?? "all";
    picker("settings-door").value = this.about.joinRule ?? "invite";
    dialog("settings").showModal();
  }

  /** Kept for you and nobody else: a conversation being a favourite is not something the others can see. */
  private async setFavourite(): Promise<void> {
    const conversationId = this.where.openId();
    if (!conversationId) return;
    await this.client.conversations
      .setFavourite(conversationId, input("settings-favourite").checked)
      .catch(error => this.show(error));
  }

  /** How much this conversation may interrupt: everything, only when it names you, or nothing. */
  private async setLoudness(): Promise<void> {
    const conversationId = this.where.openId();
    if (!conversationId) return;
    await this.client.conversations
      .setNotifications(conversationId, asLoudness(picker("settings-loudness").value))
      .catch(error => this.show(error));
  }

  /** Who may come in. Everybody sees this one, and a conversation says who is allowed to change it. */
  private async setDoor(): Promise<void> {
    const conversationId = this.where.openId();
    if (!conversationId) return;
    await this.client.conversations
      .setJoinRule(conversationId, asDoor(picker("settings-door").value))
      .catch(error => this.show(error));
  }

  /** Only what changed is sent: renaming a conversation to the name it already has is an event for nothing. */
  private async save(): Promise<void> {
    const was = this.about;
    if (!was) return;
    const name = input("settings-name").value.trim();
    const topic = input("settings-topic").value.trim();
    try {
      if (name && name !== was.title) await this.client.conversations.rename(was.id, name);
      if (topic !== (was.topic ?? "")) await this.client.conversations.setTopic(was.id, topic);
      dialog("settings").close();
    } catch (error) {
      this.show(error);
    }
  }

  private async changePicture(): Promise<void> {
    const was = this.about;
    const picture = await chosenIn("settings-file");
    if (!was || !picture) return;
    await this.client.conversations.setAvatar(was.id, picture).catch(error => this.show(error));
  }

  private show(error: unknown): void {
    const where = element("settings-wrong");
    where.textContent = error instanceof Error ? error.message : String(error);
    where.hidden = false;
  }
}

/** The picture somebody picked, as bytes and a type, which is what the library takes. */
export async function chosenIn(id: string): Promise<AvatarImage | undefined> {
  const box = input(id);
  const picked = box.files?.[0];
  box.value = "";
  if (!picked) return undefined;
  return { data: new Uint8Array(await picked.arrayBuffer()), mimeType: picked.type };
}

/** A checkbox or a picker changing, which is a different moment from a form being submitted. */
function whenChanged(id: string, what: () => void): void {
  element(id).addEventListener("change", what);
}

/**
 * How loud a conversation may be, said the way this library says it.
 *
 * Read off a picker, so the only three that mean anything are the three it offers; anything else is what a
 * browser extension or a stale page gave us, and the safe answer is the one that interrupts least.
 */
function asLoudness(chosen: string): "all" | "mentions" | "none" {
  if (chosen === "mentions") return "mentions";
  if (chosen === "none") return "none";
  return "all";
}

/** The same for the door, and with the same reasoning: the narrowest one is the safe default. */
function asDoor(chosen: string): "public" | "invite" | "knock" {
  if (chosen === "public") return "public";
  if (chosen === "knock") return "knock";
  return "invite";
}

/** The one place a picker is read, so nothing else has to know what shape it is. */
function picker(id: string): HTMLSelectElement {
  const found = element(id);
  if (!(found instanceof HTMLSelectElement)) {
    throw new Error(`#${id} is not something to choose from`);
  }
  return found;
}
