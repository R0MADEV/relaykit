import type { ConversationId, MessagingClient } from "@relaykit/web";
import { element, onClick } from "./dom.js";

/**
 * The two ways of saying something that are not typing it: a voice note, and a sticker.
 *
 * Kept together because they are the same shape — take some bytes, hand them over as what they are — and
 * apart from the composer because neither has anything to do with the box people write in.
 */
export class OtherWaysToSayIt {
  private recording: MediaRecorder | undefined;

  constructor(
    private readonly client: MessagingClient,
    private readonly around: {
      readonly openId: () => ConversationId | undefined;
      readonly wentWrong: (error: unknown) => void;
    }
  ) {}

  wire(): void {
    onClick("record", () => void this.recordOrStop());
    onClick("send-a-sticker", () => void this.sendASticker());
  }

  /** Pressed once it starts, pressed again it stops and goes. The microphone is let go of either way. */
  private async recordOrStop(): Promise<void> {
    if (this.recording) return void this.recording.stop();
    if (!this.around.openId()) return;
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(microphone);
      const pieces: Blob[] = [];
      const startedAt = Date.now();
      recorder.ondataavailable = piece => pieces.push(piece.data);
      recorder.onstop = () => {
        for (const track of microphone.getTracks()) track.stop();
        this.recording = undefined;
        this.showRecording(false);
        void this.sendTheNote(new Blob(pieces, { type: recorder.mimeType }), Date.now() - startedAt);
      };
      recorder.start();
      this.recording = recorder;
      this.showRecording(true);
    } catch (error) {
      this.around.wentWrong(error);
    }
  }

  private showRecording(going: boolean): void {
    element("record").textContent = going ? "⏹" : "🎤";
    element("record").classList.toggle("recording", going);
  }

  private async sendTheNote(audio: Blob, durationMs: number): Promise<void> {
    const conversationId = this.around.openId();
    if (!conversationId) return;
    const data = new Uint8Array(await audio.arrayBuffer());
    try {
      await this.client.messages.sendVoice(
        conversationId,
        { data, mimeType: audio.type || "audio/webm", name: "nota-de-voz" },
        { durationMs, waveform: shapeOf(data) }
      );
    } catch (error) {
      this.around.wentWrong(error);
    }
  }

  /** Drawn right here: what matters is seeing it painted on its own, not where the picture came from. */
  private async sendASticker(): Promise<void> {
    element("more-menu").hidden = true;
    const conversationId = this.around.openId();
    if (!conversationId) return;
    const drawn = await aSmileyFace();
    if (!drawn) return;
    try {
      await this.client.messages.sendSticker(conversationId, {
        data: drawn,
        mimeType: "image/png",
        name: "pegatina",
        width: stickerSize,
        height: stickerSize
      });
    } catch (error) {
      this.around.wentWrong(error);
    }
  }
}

const stickerSize = 128;

/**
 * The waveform that travels with a voice note: what shows at a glance where the pauses are.
 *
 * Measured off the bytes themselves, which is the only thing to hand without decoding the whole of it. It is
 * a picture of the sound and not a measurement of it, which is all it has to be.
 */
function shapeOf(data: Uint8Array): number[] {
  return Array.from({ length: 30 }, (_step, at) => {
    const into = Math.floor((at / 30) * data.length);
    return Math.abs((data[into] ?? 128) - 128) * 8;
  });
}

async function aSmileyFace(): Promise<Uint8Array | undefined> {
  const canvas = document.createElement("canvas");
  canvas.width = stickerSize;
  canvas.height = stickerSize;
  const brush = canvas.getContext("2d");
  if (brush) {
    brush.fillStyle = "#f5c542";
    brush.beginPath();
    brush.arc(64, 64, 60, 0, Math.PI * 2);
    brush.fill();
    brush.font = "64px serif";
    brush.fillText("😀", 32, 88);
  }
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined;
}
