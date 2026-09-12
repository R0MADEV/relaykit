/**
 * The identifiers seen lately, so the same message is not announced twice. It forgets the oldest once it is
 * full: remembering every message ever seen would grow for as long as the application stays open, and anything
 * that far back is not going to arrive again in the same session.
 */
export class RecentIds {
  private readonly ids = new Set<string>();

  constructor(private readonly limit: number) {}

  add(id: string): void {
    // Adding one that is already here would keep its old place, and it deserves to count as recent again.
    this.ids.delete(id);
    this.ids.add(id);
    while (this.ids.size > this.limit) {
      const oldest = this.ids.values().next().value;
      if (oldest === undefined) return;
      this.ids.delete(oldest);
    }
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  clear(): void {
    this.ids.clear();
  }
}
