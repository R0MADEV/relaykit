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
    dialog("settings").showModal();
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
