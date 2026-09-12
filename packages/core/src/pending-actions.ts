/**
 * What somebody did while there was no homeserver to tell. Sending a message has the outbox; these are the
 * smaller things around it: a reaction, a correction, a deletion. They are kept by what they act on, so doing
 * the same thing twice while away only counts once, and the last one is what happens.
 *
 * They live only while the client runs. Anything that must survive being closed goes through the outbox.
 */
export class PendingActions {
  private readonly actions = new Map<string, () => Promise<unknown>>();

  remember(target: string, action: () => Promise<unknown>): void {
    this.actions.set(target, action);
  }

  forget(target: string): void {
    this.actions.delete(target);
  }

  /** Does what was waiting. One that fails again is kept for the next time there is a connection. */
  async runWhatIsWaiting(onError: (error: unknown) => void): Promise<void> {
    for (const [target, action] of [...this.actions]) {
      this.actions.delete(target);
      try {
        await action();
      } catch (error) {
        this.actions.set(target, action);
        onError(error);
      }
    }
  }

  clear(): void {
    this.actions.clear();
  }
}
