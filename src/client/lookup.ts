// The character search in the tab bar. Results drop down under the field as you type.
import { h, clear, avatar, type Child } from './dom.js';
import { api, type RegionId, type SearchHit } from './api.js';
import { REGIONS } from './store.js';

const DEBOUNCE_MS = 350;

export function initLookup({ root, getRegion, setRegion, onPick }: {
  root: HTMLElement;
  getRegion: () => RegionId;
  setRegion: (region: RegionId) => void;
  onPick: (hit: SearchHit) => void;
}): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let token = 0;
  let lastQuery = '';

  const region = h('select', {
    name: 'region',
    'aria-label': 'Region',
    onchange: () => {
      const picked = REGIONS.find((r) => r.id === region.value)?.id;
      if (picked) setRegion(picked);
      lastQuery = '';
      void search();
    },
  }, REGIONS.map((r) => h('option', { value: r.id }, r.label)));
  const input = h('input', {
    type: 'search',
    name: 'name',
    placeholder: 'Look up a character',
    'aria-label': 'Character name',
    maxlength: 24,
    spellcheck: 'false',
    autocomplete: 'off',
    oninput: () => {
      clearTimeout(timer);
      timer = setTimeout(() => void search(), DEBOUNCE_MS);
    },
    onfocus: () => {
      if (results.childElementCount && input.value.trim().length >= 2) results.hidden = false;
    },
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        rows()[0]?.focus();
      }
    },
  });
  const results = h('div', { class: 'lookup-results', hidden: true, 'aria-live': 'polite' });

  const form = h('form', {
    class: 'lookup',
    role: 'search',
    autocomplete: 'off',
    onsubmit: (e: Event) => {
      e.preventDefault();
      clearTimeout(timer);
      lastQuery = '';
      void search();
    },
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !results.hidden) {
        results.hidden = true;
        input.focus();
        return;
      }
      if (!(e.target instanceof HTMLElement) || !e.target.matches('.lookup-row')) return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const list = rows();
      const next = list[list.indexOf(e.target as HTMLButtonElement) + (e.key === 'ArrowDown' ? 1 : -1)];
      (next ?? input).focus();
    },
  }, h('div', { class: 'lookup-field' }, region, input), results);
  clear(root, form);

  document.addEventListener('pointerdown', (e) => {
    if (e.target instanceof Node && !form.contains(e.target)) results.hidden = true;
  });

  const rows = (): HTMLButtonElement[] => [...results.querySelectorAll<HTMLButtonElement>('.lookup-row')];

  function show(...children: Child[]): void {
    clear(results, children);
    results.hidden = false;
  }

  async function search(): Promise<void> {
    const name = input.value.trim();
    const where = getRegion();
    if (name.length < 2) {
      token++;
      lastQuery = '';
      results.hidden = true;
      return;
    }
    const query = `${where}/${name}`;
    if (query === lastQuery) return;
    lastQuery = query;
    const mine = ++token;
    show(h('p', { class: 'lookup-note muted' }, 'Searching…'));
    try {
      const { results: list, total } = await api.search(where, name);
      if (mine !== token) return;
      if (!list.length) {
        show(h('p', { class: 'lookup-note muted' }, `No one named “${name}” on ${REGIONS.find((r) => r.id === where)?.label ?? where}`));
        return;
      }
      // NC ranks by name match, which for a common name puts a run of level 1s first
      show(
        [...list].sort((a, b) => b.level - a.level).map((hit) => h('button', {
          class: 'lookup-row',
          type: 'button',
          onclick: () => {
            results.hidden = true;
            input.blur();
            onPick(hit);
          },
        },
          avatar(hit, 'small'),
          h('span', { class: 'lookup-text' },
            h('span', { class: 'lookup-name' }, hit.name),
            h('span', { class: 'muted small' }, [`Lv ${hit.level}`, hit.className, hit.serverName].filter(Boolean).join(' · '))))),
        total > list.length && h('p', { class: 'lookup-note muted small' }, `Showing ${list.length} of ${total}`));
    } catch (err) {
      if (mine === token) show(h('p', { class: 'lookup-note error' }, err instanceof Error ? err.message : String(err)));
    }
  }

  // the region tracks the one the add-character dialog last used
  region.value = getRegion();
  root.addEventListener('focusin', () => {
    if (region.value !== getRegion()) region.value = getRegion();
  });
}
