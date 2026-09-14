/** Finding things in the page, and being told at once when the page is not what the code expects. */

export function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`The page has no ${id}`);
  return found;
}

/** Asked for rather than asserted: a field that turned out to be a heading is a mistake worth hearing about. */
export function input(id: string): HTMLInputElement {
  const found = element(id);
  if (!(found instanceof HTMLInputElement)) throw new Error(`${id} is not a text field`);
  return found;
}

export function dialog(id: string): HTMLDialogElement {
  const found = element(id);
  if (!(found instanceof HTMLDialogElement)) throw new Error(`${id} is not a dialog`);
  return found;
}

export function form(id: string): HTMLFormElement {
  const found = element(id);
  if (!(found instanceof HTMLFormElement)) throw new Error(`${id} is not a form`);
  return found;
}

export function onClick(id: string, what: () => void): void {
  element(id).addEventListener("click", what);
}

export function onSubmit(id: string, what: () => void): void {
  form(id).addEventListener("submit", event => {
    event.preventDefault();
    what();
  });
}

/**
 * The button of a list that was pressed, found by walking up from whatever inside it took the click.
 *
 * Lists here are repainted whole, so listening on each row would mean rewiring after every change. One
 * listener on the list that never goes away is both less code and one fewer thing to forget.
 */
export function pressedIn(event: Event, mark: string): string | undefined {
  const { target } = event;
  if (!(target instanceof Element)) return undefined;
  const row = target.closest(`[data-${mark}]`);
  if (!(row instanceof HTMLElement)) return undefined;
  return row.dataset[asDatasetKey(mark)];
}

/** `data-opens-thread` in the markup is `opensThread` in the dataset, and the two have to be kept in step. */
function asDatasetKey(mark: string): string {
  return mark.replace(/-([a-z])/g, (_whole, letter: string) => letter.toUpperCase());
}

// Escaping lives with the text that needs it, and is handed on from here so nothing has two places
// to import the same thing from.
export { safe } from "./writing.js";
