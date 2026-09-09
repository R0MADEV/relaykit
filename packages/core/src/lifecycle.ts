import type { MessagingAdapter } from "./adapter.js";

export async function stopAdapterAfterStartFailure(
  adapter: MessagingAdapter,
  emitError: (error: unknown) => void
): Promise<void> {
  try {
    await adapter.stop();
  } catch (error) {
    emitError(error);
  }
}
