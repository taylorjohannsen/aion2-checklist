// h('button', { class: 'x', onclick }, 'text', child) -> element. Text is always set as
// text, never parsed as HTML, so names from the API can't inject markup.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style') for (const [prop, v] of Object.entries(value)) el.style.setProperty(prop, v);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'value') el.value = value;
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

export function clear(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

export const $ = (selector, root = document) => root.querySelector(selector);

let toastTimer;
export function toast(message, action) {
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

export const number = (n) => (Number.isFinite(n) ? n.toLocaleString() : '—');

export function timeAgo(ts) {
  const minutes = Math.round((Date.now() - ts) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
