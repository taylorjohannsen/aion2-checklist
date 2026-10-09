// Item lookup: searches the offline index (data/items.json, built by
// src/scripts/build-items.ts) plus the hand-written "where to get it" entries in
// data/sources.json. Descriptions are fetched live from NCSOFT per item.
import { h, clear, toast, type Child } from './dom.js';
import { api, type ItemInfo } from './api.js';
import { iconURL } from './icons.js';
import type { State } from './store.js';

// ---------- data files ----------

type SourceType = 'shop' | 'content' | 'craft' | 'gather' | 'other';

interface CuratedSource {
  type?: SourceType;
  where: string;
  cost?: string;
  limit?: string;
  note?: string;
}

/** One hand-written entry in public/data/sources.json. */
interface CuratedEntry {
  /** NC item id, when the thing is a real item; currencies use `key` instead */
  id?: number;
  key?: string;
  name: string;
  kind?: string;
  grade?: string;
  icon?: string;
  aliases?: string[];
  summary?: string;
  sources?: CuratedSource[];
  refs?: string[];
}

interface SourcesFile {
  updated?: string;
  about?: string;
  items: CuratedEntry[];
}

/** items.json stores rows as tuples to stay small: [id, name, grade, category, icon]. */
type IndexTuple = [id: number, name: string, grade: string, category: string, icon: string];

interface ItemsFile {
  generated?: string;
  iconBase?: string;
  items: IndexTuple[];
}

// ---------- the in-memory index ----------

interface Row {
  key: string;
  id: number | null;
  name: string;
  grade: string;
  category: string;
  icon: string;
  curated?: CuratedEntry;
  /** lowercased name, for ranking */
  lower: string;
  /** name plus aliases, for matching */
  haystack: string;
  /** a deep-linked id that isn't in the index, until its live record arrives */
  placeholder?: boolean;
}

interface Index {
  rows: Row[];
  byKey: Map<string, Row>;
  iconBase: string;
  sources: SourcesFile;
  generated?: string | undefined;
}

/** What the item panel knows about an item from NC: the full record, or `{ desc: '' }` after a failed fetch. */
type LiveRecord = Partial<ItemInfo>;

export interface ItemsView {
  show(): Promise<void>;
  open(key: string): Promise<void>;
  refresh(): void;
}

const SOURCE_TYPES: Record<SourceType, string> = {
  shop: 'Shop',
  content: 'Content',
  craft: 'Craft',
  gather: 'Gather',
  other: 'Other',
};

const MAX_RESULTS = 60;

const fetchJSON = <T>(url: string, fallback: T): Promise<T> =>
  fetch(url)
    .then((r) => (r.ok ? (r.json() as Promise<T>) : fallback))
    .catch(() => fallback);

export function initItems({ root, getState, commit }: {
  root: HTMLElement;
  getState: () => State;
  commit: () => void;
}): ItemsView {
  let index: Index | null = null;
  let loading: Promise<Index> | null = null;
  let selected: Row | null = null;
  let notesTimer: ReturnType<typeof setTimeout> | undefined;
  const details = new Map<number, LiveRecord | Promise<void>>(); // live NCSOFT record, or the fetch for one

  const input = h('input', {
    id: 'item-query',
    type: 'text',
    placeholder: 'Search items, e.g. Stigma Shard',
    autocomplete: 'off',
    spellcheck: 'false',
    oninput: () => renderResults(),
  });
  const clearButton = h('button', {
    class: 'item-clear',
    type: 'button',
    'aria-label': 'Clear search',
    hidden: true,
    onclick: () => {
      input.value = '';
      renderResults();
      input.focus();
    },
  }, '×');
  const hint = h('p', { class: 'muted small item-hint' });
  const results = h('div', { class: 'item-results' });
  const detail = h('div', { class: 'item-detail', 'aria-live': 'polite' });
  clear(root,
    h('div', { class: 'items-layout' },
      h('div', { class: 'items-search' },
        h('label', { class: 'visually-hidden', for: 'item-query' }, 'Search items'),
        h('div', { class: 'search-field' }, input, clearButton),
        hint, results),
      detail));

  document.addEventListener('keydown', (e) => {
    const typing = e.target instanceof Element && e.target.closest('input, textarea, select');
    if (e.key !== '/' || root.hidden || typing) return;
    e.preventDefault();
    input.focus();
  });

  async function load(): Promise<Index> {
    if (index) return index;
    loading ||= Promise.all([
      fetchJSON<ItemsFile>('/data/items.json', { items: [] }),
      fetchJSON<SourcesFile>('/data/sources.json', { items: [] }),
    ]).then(([items, sources]) => buildIndex(items, sources));
    index = await loading;
    return index;
  }

  function buildIndex(itemData: ItemsFile, sourceData: SourcesFile): Index {
    const byKey = new Map<string, Row>();
    const iconBase = itemData.iconBase || '';
    for (const [id, name, grade, category, icon] of itemData.items || []) {
      byKey.set(String(id), { key: String(id), id, name, grade, category, icon: icon ? iconBase + icon : '', lower: '', haystack: '' });
    }
    for (const entry of sourceData.items || []) {
      const key = entry.id ? String(entry.id) : entry.key;
      if (!key) continue;
      const row = byKey.get(key) || {
        key,
        id: entry.id || null,
        name: entry.name,
        grade: entry.grade || '',
        category: entry.kind || '',
        icon: entry.icon ? iconURL(entry.icon) : '',
        lower: '',
        haystack: '',
      };
      row.curated = entry;
      byKey.set(key, row);
    }
    const rows = [...byKey.values()];
    for (const row of rows) {
      row.lower = row.name.toLowerCase();
      row.haystack = [row.lower, ...(row.curated?.aliases || []).map((a) => a.toLowerCase())].join(' | ');
    }
    return { rows, byKey, iconBase, sources: sourceData, generated: itemData.generated };
  }

  function search(idx: Index, q: string): { total: number; rows: Row[] } {
    const query = q.trim().toLowerCase();
    const terms = query.split(/\s+/).filter(Boolean);
    const first = terms[0] ?? '';
    const scored: [number, Row][] = [];
    for (const row of idx.rows) {
      if (!terms.every((t) => row.haystack.includes(t))) continue;
      let score = 0;
      if (row.lower === query) score += 100;
      else if (row.lower.startsWith(query)) score += 50;
      else if (row.lower.split(/[\s:()]+/).some((w) => w.startsWith(first))) score += 20;
      if (row.curated) score += 40;
      scored.push([score - row.name.length / 100, row]);
    }
    scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name));
    return { total: scored.length, rows: scored.slice(0, MAX_RESULTS).map(([, row]) => row) };
  }

  // ---------- rendering ----------

  function blankIcon(row: Row, size: number): HTMLSpanElement {
    return h('span', { class: 'item-icon item-icon-blank', 'aria-hidden': 'true', style: { '--size': `${size}px` } }, row.name.slice(0, 1));
  }

  function itemIcon(row: Row, size = 40): HTMLElement {
    if (!row.icon) return blankIcon(row, size);
    return h('img', {
      class: 'item-icon',
      src: row.icon,
      alt: '',
      width: size,
      height: size,
      loading: 'lazy',
      decoding: 'async',
      onerror: (e: Event) => (e.currentTarget as Element).replaceWith(blankIcon(row, size)),
    });
  }

  const gradeClass = (grade: string): string => (grade ? `grade-${grade.toLowerCase()}` : '');

  function resultButton(row: Row): HTMLLIElement {
    const pinned = getState().items.pinned.includes(row.key);
    return h('li', {},
      h('button', {
        class: `item-row${selected?.key === row.key ? ' is-selected' : ''}`,
        type: 'button',
        onclick: () => select(row),
      },
        itemIcon(row),
        h('span', { class: 'item-row-text' },
          h('span', { class: `item-name ${gradeClass(row.grade)}` }, row.name),
          h('span', { class: 'muted small' }, [row.category, row.grade].filter(Boolean).join(' · '))),
        h('span', { class: 'item-badges' },
          row.curated && h('span', { class: 'badge', title: 'Has where-to-get-it info' }, 'Sources'),
          pinned && h('span', { class: 'badge badge-pin', title: 'Pinned' }, '★'))));
  }

  function renderResults(): void {
    const q = input.value;
    // before the index guard: text typed while items.json is still loading should get its ×
    clearButton.hidden = !q;
    const idx = index;
    if (!idx) return;
    // an empty box shows nothing but whatever the visitor pinned
    if (!q.trim()) {
      const pinned = getState().items.pinned
        .map((k) => idx.byKey.get(k))
        .filter((row): row is Row => row !== undefined);
      hint.textContent = `${idx.rows.length.toLocaleString()} items. Press / to search.`;
      clear(results,
        pinned.length > 0 && [h('h3', { class: 'list-title' }, 'Pinned'), h('ul', { class: 'item-list' }, pinned.map(resultButton))]);
      return;
    }
    const { total, rows } = search(idx, q);
    hint.textContent = total
      ? total > rows.length ? `Top ${rows.length} of ${total.toLocaleString()} matches` : `${total} match${total === 1 ? '' : 'es'}`
      : '';
    clear(results, rows.length
      ? h('ul', { class: 'item-list' }, rows.map(resultButton))
      : h('p', { class: 'muted' }, `Nothing matches “${q.trim()}”. Try part of the name.`));
  }

  function renderDetail(): void {
    if (!selected) {
      clear(detail, h('div', { class: 'item-empty' },
        h('h2', {}, 'Find where to get things'),
        h('p', { class: 'muted' }, 'Search any item to see its description, the shops and content that give it, and your own notes. Pin the ones you check every week.')));
      return;
    }
    const row = selected;
    const state = getState();
    const pinned = state.items.pinned.includes(row.key);
    const live = row.id ? details.get(row.id) : undefined;
    const loaded = live && !(live instanceof Promise) ? live : null;
    const curated = row.curated;
    const official = loaded?.sources ?? [];
    const sources = curated?.sources ?? [];
    const hasOfficial = official.length > 0;
    const hasCurated = sources.length > 0;
    let description: Child = null;
    if (row.id) {
      description = loaded
        ? loaded.desc || h('span', { class: 'muted' }, 'No description.')
        : h('span', { class: 'muted' }, 'Loading description…');
    }

    clear(detail,
      h('div', { class: 'item-head' },
        itemIcon(row, 64),
        h('div', { class: 'item-head-text' },
          h('h2', { class: `item-title ${gradeClass(row.grade)}` }, row.name),
          h('p', { class: 'muted' }, [row.category, row.grade, loaded?.tradable ? 'Tradable' : null].filter(Boolean).join(' · ')))),
      h('div', { class: 'item-actions' },
        h('button', { class: `button small${pinned ? '' : ' ghost'}`, type: 'button', 'aria-pressed': String(pinned), onclick: () => togglePin(row) }, pinned ? '★ Pinned' : '☆ Pin'),
        h('button', { class: 'button small ghost', type: 'button', onclick: () => copyLink(row) }, 'Copy link')),
      curated?.summary && h('p', { class: 'item-summary' }, curated.summary),
      description && h('p', { class: 'item-desc' }, description),
      h('section', { class: 'item-section' },
        h('h3', {}, 'Where to get it'),
        // NC's own categories, when the live record has them
        hasOfficial && h('ul', { class: 'src-tags' }, official.map((s) => h('li', { class: 'src-tag' }, s))),
        hasCurated && [
          h('ul', { class: 'source-list' }, sources.map((s) => h('li', { class: 'source' },
            h('span', { class: `source-type type-${s.type || 'other'}` }, SOURCE_TYPES[s.type ?? 'other'] || 'Other'),
            h('div', { class: 'source-body' },
              h('strong', {}, s.where),
              s.cost && h('span', {}, s.cost),
              (s.limit || s.note) && h('span', { class: 'muted small' }, [s.limit && `Limit: ${s.limit}`, s.note].filter(Boolean).join(' · ')))))),
          h('p', { class: 'muted small' },
            'Community-reported',
            index?.sources.updated ? `, checked ${index.sources.updated}` : '',
            curated?.refs?.length ? ['. Sources: ', curated.refs.map((url, i) => [i ? ', ' : '', h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, new URL(url).hostname.replace(/^www\./, ''))])] : '',
            '.'),
        ],
        // the tags alone are enough of an answer; only a wholly bare section needs a prompt
        !hasOfficial && !hasCurated && h('p', { class: 'muted' }, 'No sources recorded for this one yet. Jot down where you found it below.')),
      h('section', { class: 'item-section' },
        h('h3', {}, h('label', { for: 'item-notes' }, 'My notes')),
        h('textarea', {
          id: 'item-notes',
          rows: 3,
          maxlength: 2000,
          placeholder: 'Shop, NPC, weekly limit… saved in this browser',
          value: state.items.notes[row.key] || '',
          oninput: (e: Event) => saveNote(row, (e.currentTarget as HTMLTextAreaElement).value),
        })),
      h('p', { class: 'small' },
        h('a', { href: `https://www.google.com/search?q=${encodeURIComponent(`AION 2 ${row.name}`)}`, target: '_blank', rel: 'noopener noreferrer' }, `Search the web for “${row.name}” ↗`)));
  }

  function select(row: Row, { scroll = true } = {}): void {
    selected = row;
    history.replaceState(null, '', `#item/${encodeURIComponent(row.key)}`);
    const id = row.id;
    if (id && !details.has(id)) {
      const request = api.item(id)
        .then((item) => {
          details.set(id, item);
          // an item missing from the index only has its ID until the live record comes back
          if (row.placeholder) {
            Object.assign(row, { name: item.name, grade: item.grade, category: item.category, icon: item.icon ? (index?.iconBase ?? '') + item.icon : '' });
            row.lower = row.name.toLowerCase();
            delete row.placeholder;
            renderResults();
          }
        })
        .catch(() => {
          details.set(id, { desc: '' });
        })
        .finally(() => {
          if (selected === row) renderDetail();
        });
      details.set(id, request);
    }
    renderResults();
    renderDetail();
    if (scroll && window.matchMedia('(max-width: 760px)').matches) detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function togglePin(row: Row): void {
    const state = getState();
    state.items.pinned = state.items.pinned.includes(row.key)
      ? state.items.pinned.filter((k) => k !== row.key)
      : [row.key, ...state.items.pinned];
    commit();
    renderResults();
    renderDetail();
  }

  function saveNote(row: Row, text: string): void {
    clearTimeout(notesTimer);
    notesTimer = setTimeout(() => {
      const state = getState();
      if (text.trim()) state.items.notes[row.key] = text.slice(0, 2000);
      else delete state.items.notes[row.key];
      commit();
    }, 400);
  }

  async function copyLink(row: Row): Promise<void> {
    const url = `${location.origin}${location.pathname}#item/${encodeURIComponent(row.key)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    } catch {
      toast(url);
    }
  }

  return {
    async show() {
      if (!index) {
        hint.textContent = 'Loading items…';
        renderDetail();
        await load();
      }
      renderResults();
      if (!selected) renderDetail();
    },
    async open(key) {
      const idx = await load();
      let row = idx.byKey.get(key);
      if (!row && /^\d{6,10}$/.test(key)) {
        row = { key, id: Number(key), name: `Item ${key}`, grade: '', category: '', icon: '', lower: '', haystack: '', placeholder: true };
        idx.byKey.set(key, row);
      }
      if (row) select(row, { scroll: false });
    },
    refresh() {
      if (!index) return;
      renderResults();
      renderDetail();
    },
  };
}
