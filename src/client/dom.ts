// h('button', { class: 'x', onclick }, 'text', child) -> element. Text is always set as
// text, never parsed as HTML, so names from the API can't inject markup.

/**
 * Anything accepted as a child. `null`, `undefined` and `false` are dropped, which is what
 * makes `cond && h(...)` work. `true` and `0` are NOT dropped and would render, so guard
 * with an explicit comparison (`list.length > 0 && ...`) rather than a bare truthy check.
 */
export type Child = Node | string | number | false | null | undefined | Child[];

type Handler = (event: Event) => void;

type Leaf = Node | string | number;

// Array#flat(Infinity) can't be typed over a recursive Child, so walk it by hand
function leaves(children: Child[], out: Leaf[] = []): Leaf[] {
  for (const child of children) {
    if (Array.isArray(child)) leaves(child, out);
    else if (child != null && child !== false) out.push(child);
  }
  return out;
}

export interface Props {
  class?: string;
  dataset?: Record<string, string>;
  style?: Record<string, string | number>;
  value?: string | number;
  [key: string]: unknown | Handler;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value as string;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style') {
      for (const [prop, v] of Object.entries(value as Record<string, string | number>)) {
        el.style.setProperty(prop, String(v));
      }
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), value as Handler);
    } else if (key === 'value') (el as HTMLInputElement).value = String(value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  for (const child of leaves(children)) el.append(child instanceof Node ? child : String(child));
  return el;
}

export function clear<T extends Element>(el: T, ...children: Child[]): T {
  el.replaceChildren(...leaves(children).map((c) => (c instanceof Node ? c : String(c))));
  return el;
}

export function $<E extends Element = HTMLElement>(selector: string, root: ParentNode = document): E {
  const found = root.querySelector<E>(selector);
  // every selector here points at markup in index.html or at something just rendered
  if (!found) throw new Error(`No element matches ${selector}`);
  return found;
}

export interface ToastAction {
  label: string;
  run: () => void;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(message: string, action?: ToastAction): void {
  const el = $('#toast');
  clearTimeout(toastTimer);
  clear(el, h('span', {}, message), action && h('button', {
    class: 'toast-action',
    type: 'button',
    onclick: () => {
      el.hidden = true;
      action.run();
    },
  }, action.label));
  el.hidden = false;
  toastTimer = setTimeout(() => (el.hidden = true), action ? 7000 : 3500);
}

export const number = (n: number | null | undefined): string => (Number.isFinite(n) ? (n as number).toLocaleString() : '—');

export function timeAgo(ts: number): string {
  const minutes = Math.round((Date.now() - ts) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
