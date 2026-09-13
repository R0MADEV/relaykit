/**
 * The keys this library sends that the SDK's types do not name yet.
 *
 * Matrix grows by proposal: a thing is used by clients for a while before it is in the spec, and longer
 * before it is in anybody's types. This library sends three of those — a blurhash, so a picture has
 * something to stand in for it while it is still arriving, and the two markers that make a voice note a
 * voice note rather than an audio file somebody attached.
 *
 * The SDK declares its content as interfaces, and an interface stays open. So rather than asserting that
 * what is built belongs to a type which does not know these keys, the type is told about them: everything
 * sent is checked, these included. The day the SDK names them itself, this file goes and nothing else
 * changes.
 */
declare module "matrix-js-sdk/lib/@types/media.js" {
  interface FileInfo {
    /** A tiny blurred stand-in for a picture, painted while the picture is still on its way. */
    "xyz.amorgan.blurhash"?: string;
  }

  interface FileContent {
    /** What makes a voice note one rather than an audio file: the marker, and the sound's own shape. */
    "org.matrix.msc3245.voice"?: Record<string, never>;
    "org.matrix.msc1767.audio"?: { duration: number; waveform?: number[] };
  }

  interface ImageContent {
    "org.matrix.msc3245.voice"?: Record<string, never>;
    "org.matrix.msc1767.audio"?: { duration: number; waveform?: number[] };
  }

  interface AudioContent {
    "org.matrix.msc3245.voice"?: Record<string, never>;
    "org.matrix.msc1767.audio"?: { duration: number; waveform?: number[] };
  }

  interface VideoContent {
    "org.matrix.msc3245.voice"?: Record<string, never>;
    "org.matrix.msc1767.audio"?: { duration: number; waveform?: number[] };
  }
}

export {};
