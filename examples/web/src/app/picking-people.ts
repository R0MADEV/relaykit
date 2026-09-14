import type { MessagingClient, User, UserId } from "@relaykit/web";
import { element, input, pressedIn, safe } from "./dom.js";
import { face, type People } from "./people.js";

/**
 * Choosing people: a box to look them up in and a list to tick them off.
 *
 * Who is ticked is kept here rather than read off the checkboxes, because looking somebody else up repaints
 * the list and a repaint would otherwise forget everybody chosen before it.
 */
export class PickingPeople {
  private readonly ticked = new Set<UserId>();
  private found: readonly User[] = [];
  private looking: number | undefined;

  constructor(
    private readonly which: string,
    private readonly client: MessagingClient,
    private readonly people: People,
    /** Told whenever the number ticked changes, so a footer can say how many are going to be invited. */
    private readonly changed: () => void = () => {}
  ) {
    input(`${which}-search`).addEventListener("input", () => this.lookAgainShortly());
    element(`${which}-people`).addEventListener("click", event => {
      const userId = pressedIn(event, "picks");
      if (userId) this.toggle(userId);
    });
  }

  chosen(): readonly UserId[] {
    return [...this.ticked];
  }

  /** Opened again is opened fresh: yesterday's ticks are not what this invitation is about. */
  start(): void {
    this.ticked.clear();
    input(`${this.which}-search`).value = "";
    this.found = [];
    this.paint();
    this.changed();
  }

  private toggle(userId: UserId): void {
    if (!this.ticked.delete(userId)) this.ticked.add(userId);
    this.paint();
    this.changed();
  }

  /**
   * Waits for the typing to stop before asking. A request per keystroke is a request per keystroke, and the
   * answers come back out of order, so the list flickers between two different searches.
   */
  private lookAgainShortly(): void {
    window.clearTimeout(this.looking);
    this.looking = window.setTimeout(() => void this.look(), 250);
  }

  private async look(): Promise<void> {
    const query = input(`${this.which}-search`).value.trim();
    if (!query) {
      this.found = [];
      this.paint();
      return;
    }
    this.found = await this.client.users.search(query).catch(() => []);
    this.people.learn(this.found.map(person => person.id));
    this.paint();
  }

  private paint(): void {
    const showing = [...this.found];
    // Somebody already ticked stays on the list even once the search that found them has moved on, or
    // choosing three people one at a time would mean the first two quietly vanishing.
    for (const userId of this.ticked) {
      if (!showing.some(person => person.id === userId)) showing.push({ id: userId });
    }
    element(`${this.which}-people`).innerHTML = showing.map(person => this.row(person)).join("");
  }

  private row(person: User): string {
    const picked = this.ticked.has(person.id);
    return `<li data-picks="${safe(person.id)}"${picked ? " data-picked" : ""}>
      ${face(this.people, person.id)}
      <span class="who-name">${safe(this.people.nameOf(person.id))}</span>
      <span class="mono faint">${safe(person.id)}</span>
      <input type="checkbox" tabindex="-1" ${picked ? "checked" : ""} />
    </li>`;
  }
}
