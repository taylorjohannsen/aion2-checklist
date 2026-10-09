// Item lookup: searches the offline index (data/items.json, built by
// scripts/build-items.mjs) plus the hand-written "where to get it" entries in
// data/sources.json. Descriptions are fetched live from NCSOFT per item.
import { h, clear, $, toast } from './dom.js';
import { api } from './api.js';
import { iconURL } from './icons.js';

const SOURCE_TYPES = {
  shop: 'Shop',
  content: 'Content',
  craft: 'Craft',
  gather: 'Gather',
  other: 'Other',
};

const MAX_RESULTS = 60;

export function initItems({ root, getState, commit }) {
  let index = null;
  let loading = null;
  let selected = null;
  let notesTimer = null;
  const details = new Map(); // item id -> live NCSOFT record (or a promise of one)

  const input = h('input', {
    id: 'item-query',
    type: 'search',
    placeholder: 'Search items, e.g. Stigma Shard',
    autocomplete: 'off',
    spellcheck: 'false',
    oninput: () => renderResults(),
  });
  const hint = h('p', { class: 'muted small item-hint' });
  const results = h('div', { class: 'item-results' });
  const detail = h('div', { class: 'item-detail', 'aria-live': 'polite' });
  clear(root,
    h('div', { class: 'items-layout' },
      h('div', { class: 'items-search' },
        h('label', { class: 'visually-hidden', for: 'item-query' }, 'Search items'),
        input, hint, results),
      detail));

  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || root.hidden || e.target.closest('input, textarea, select')) return;
    e.preventDefault();
    input.focus();
  });

  async function load() {
    if (index) return index;
    loading ||= Promise.all([
      fetch('/data/items.json').then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] })),
      fetch('/data/sources.json').then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] })),
    ]).then(([items, sources]) => buildIndex(items, sources));
    index = await loading;
    return index;
  }

  function buildIndex(itemData, sourceData) {
    const byKey = new Map();
    const iconBase = itemData.iconBase || '';
    for (const [id, name, grade, category, icon] of itemData.items || []) {
      byKey.set(String(id), { key: String(id), id, name, grade, category, icon: icon ? iconBase + icon : '' });
    }
    for (const entry of sourceData.items || []) {
      const key = entry.id ? String(entry.id) : entry.key;
      const row = byKey.get(key) || {
        key,
        id: entry.id || null,
        name: entry.name,
        grade: entry.grade || '',
        category: entry.kind || '',
        icon: entry.icon ? iconURL(entry.icon) : '',
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

  function search(q) {
    const query = q.trim().toLowerCase();
    const terms = query.split(/\s+/).filter(Boolean);
    const scored = [];
    for (const row of index.rows) {
      if (!terms.every((t) => row.haystack.includes(t))) continue;
      let score = 0;
      if (row.lower === query) score += 100;
      else if (row.lower.startsWith(query)) score += 50;
      else if (row.lower.split(/[\s:()]+/).some((w) => w.startsWith(terms[0]))) score += 20;
      if (row.curated) score += 40;
      scored.push([score - row.name.length / 100, row]);
    }
    scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name));
    return { total: scored.length, rows: scored.slice(0, MAX_RESULTS).map(([, row]) => row) };
  }

  // ---------- rendering ----------

  function itemIcon(row, size = 40) {
    if (!row.icon) {
      return h('span', { class: 'item-icon item-icon-blank', 'aria-hidden': 'true', style: { '--size': `${size}px` } }, row.name.slice(0, 1));
    }
    return h('img', {
      class: 'item-icon',
      src: row.icon,
      alt: '',
      width: size,
      height: size,
      loading: 'lazy',
      decoding: 'async',
      onerror: (e) => e.currentTarget.replaceWith(h('span', { class: 'item-icon item-icon-blank', 'aria-hidden': 'true', style: { '--size': `${size}px` } }, row.name.slice(0, 1))),
    });
  }

  const gradeClass = (grade) => (grade ? `grade-${grade.toLowerCase()}` : '');

  function resultButton(row) {
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

  function renderResults() {
    if (!index) return;
    const q = input.value;
    if (!q.trim()) {
      const state = getState();
      const pinned = state.items.pinned.map((k) => index.byKey.get(k)).filter(Boolean);
      const curated = index.rows.filter((row) => row.curated && !state.items.pinned.includes(row.key));
      hint.textContent = `${index.rows.length.toLocaleString()} items. Press / to search.`;
      clear(results,
        pinned.length > 0 && [h('h3', { class: 'list-title' }, 'Pinned'), h('ul', { class: 'item-list' }, pinned.map(resultButton))],
        h('h3', { class: 'list-title' }, 'Where to get it'),
        h('ul', { class: 'item-list' }, curated.map(resultButton)));
      return;
    }
    const { total, rows } = search(q);
    hint.textContent = total
      ? total > rows.length ? `Top ${rows.length} of ${total.toLocaleString()} matches` : `${total} match${total === 1 ? '' : 'es'}`
      : '';
    clear(results, rows.length
      ? h('ul', { class: 'item-list' }, rows.map(resultButton))
      : h('p', { class: 'muted' }, `Nothing matches “${q.trim()}”. Try part of the name.`));
  }

  function renderDetail() {
    if (!selected) {
      clear(detail, h('div', { class: 'item-empty' },
        h('h2', {}, 'Find where to get things'),
        h('p', { class: 'muted' }, 'Search any item to see its description, the shops and content that give it, and your own notes. Pin the ones you check every week.')));
      return;
    }
    const row = selected;
    const state = getState();
    const pinned = state.items.pinned.includes(row.key);
    const live = row.id ? details.get(row.id) : null;
    const loaded = live && !(live instanceof Promise);
    const curated = row.curated;
    let description = null;
    if (row.id) {
      description = loaded
        ? live.desc || h('span', { class: 'muted' }, 'No description.')
        : h('span', { class: 'muted' }, 'Loading description…');
    }

    clear(detail,
      h('div', { class: 'item-head' },
        itemIcon(row, 64),
        h('div', { class: 'item-head-text' },
          h('h2', { class: `item-title ${gradeClass(row.grade)}` }, row.name),
          h('p', { class: 'muted' }, [row.category, row.grade, loaded && live.tradable ? 'Tradable' : null].filter(Boolean).join(' · ')))),
      h('div', { class: 'item-actions' },
        h('button', { class: `button small${pinned ? '' : ' ghost'}`, type: 'button', 'aria-pressed': String(pinned), onclick: () => togglePin(row) }, pinned ? '★ Pinned' : '☆ Pin'),
        h('button', { class: 'button small ghost', type: 'button', onclick: () => copyLink(row) }, 'Copy link')),
      curated?.summary && h('p', { class: 'item-summary' }, curated.summary),
      description && h('p', { class: 'item-desc' }, description),
      h('section', { class: 'item-section' },
        h('h3', {}, 'Where to get it'),
        curated?.sources?.length
          ? [
            h('ul', { class: 'source-list' }, curated.sources.map((s) => h('li', { class: 'source' },
              h('span', { class: `source-type type-${s.type || 'other'}` }, SOURCE_TYPES[s.type] || 'Other'),
              h('div', { class: 'source-body' },
                h('strong', {}, s.where),
                s.cost && h('span', {}, s.cost),
                (s.limit || s.note) && h('span', { class: 'muted small' }, [s.limit && `Limit: ${s.limit}`, s.note].filter(Boolean).join(' · ')))))),
            h('p', { class: 'muted small' },
              'Community-reported',
              index.sources.updated ? `, checked ${index.sources.updated}` : '',
              curated.refs?.length ? ['. Sources: ', curated.refs.map((url, i) => [i ? ', ' : '', h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, new URL(url).hostname.replace(/^www\./, ''))])] : '',
              '.'),
          ]
          : h('p', { class: 'muted' }, 'No sources recorded for this one yet. Jot down where you found it below.')),
      h('section', { class: 'item-section' },
        h('h3', {}, h('label', { for: 'item-notes' }, 'My notes')),
        h('textarea', {
          id: 'item-notes',
          rows: 3,
          maxlength: 2000,
          placeholder: 'Shop, NPC, weekly limit… saved in this browser',
          value: state.items.notes[row.key] || '',
          oninput: (e) => saveNote(row, e.currentTarget.value),
        })),
      h('p', { class: 'small' },
        h('a', { href: `https://www.google.com/search?q=${encodeURIComponent(`AION 2 ${row.name}`)}`, target: '_blank', rel: 'noopener noreferrer' }, `Search the web for “${row.name}” ↗`)));
  }

  function select(row, { scroll = true } = {}) {
    selected = row;
    history.replaceState(null, '', `#item/${encodeURIComponent(row.key)}`);
    if (row.id && !details.has(row.id)) {
      const request = api.item(row.id)
        .then((item) => {
          details.set(row.id, item);
          // an item missing from the index only has its ID until the live record comes back
          if (row.placeholder) {
            Object.assign(row, { name: item.name, grade: item.grade, category: item.category, icon: item.icon ? index.iconBase + item.icon : '' });
            delete row.placeholder;
            renderResults();
          }
        })
        .catch(() => details.set(row.id, { desc: '' }))
        .finally(() => {
          if (selected === row) renderDetail();
        });
      details.set(row.id, request);
    }
    renderResults();
    renderDetail();
    if (scroll && window.matchMedia('(max-width: 760px)').matches) detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function togglePin(row) {
    const state = getState();
    state.items.pinned = state.items.pinned.includes(row.key)
      ? state.items.pinned.filter((k) => k !== row.key)
      : [row.key, ...state.items.pinned];
    commit();
    renderResults();
    renderDetail();
  }

  function saveNote(row, text) {
    clearTimeout(notesTimer);
    notesTimer = setTimeout(() => {
      const state = getState();
      if (text.trim()) state.items.notes[row.key] = text.slice(0, 2000);
      else delete state.items.notes[row.key];
      commit();
    }, 400);
  }

  async function copyLink(row) {
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
      await load();
      let row = index.byKey.get(key);
      if (!row && /^\d{6,10}$/.test(key)) {
        row = { key, id: Number(key), name: `Item ${key}`, grade: '', category: '', icon: '', haystack: '', placeholder: true };
        index.byKey.set(key, row);
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
