import { h, clear, $, toast, number, timeAgo } from './dom.js';
import * as store from './store.js';
import type { Character, Tab } from './store.js';
import { api, type RegionId, type SearchHit } from './api.js';
import { ICONS, iconURL } from './icons.js';
import { PERIODS, MAX_COUNT, type Period, type ResolvedTask } from './tasks.js';
import { EVENTS, eventStatus, formatDuration, formatLocalTime, nextDailyReset, nextWeeklyReset } from './time.js';
import { initItems } from './items.js';

let state = store.loadState();
let storageWarned = false;

function commit(): void {
  if (!store.saveState(state) && !storageWarned) {
    storageWarned = true;
    toast('This browser is blocking storage, so progress won’t be kept after you close the tab.');
  }
}

const regionLabel = (id: RegionId): string => store.REGIONS.find((r) => r.id === id)?.label || '';
const active = (): Character | undefined => store.activeCharacter(state);
const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// Form controls by name. The markup is ours, so a missing control is a bug, not input.
function control<T extends HTMLInputElement | HTMLSelectElement>(form: HTMLFormElement, name: string): T {
  const el = form.elements.namedItem(name);
  if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) throw new Error(`Form has no ${name} control`);
  return el as T;
}

// ---------- header timers ----------

const countdowns: { id: Period; label: string; next: (now?: number) => number }[] = [
  { id: 'daily', label: 'Daily reset', next: nextDailyReset },
  { id: 'weekly', label: 'Weekly reset', next: nextWeeklyReset },
];

function buildTimers(): void {
  const timer = (id: string, label: string, kind: 'reset' | 'event') =>
    h('div', { class: `timer timer-${kind}`, id: `timer-${id}` },
      h('span', { class: 'timer-label' }, label),
      h('span', { class: 'timer-value' }, '…'));
  clear($('#timers'),
    h('div', { class: 'timer-group', 'aria-label': 'Resets' }, countdowns.map((c) => timer(c.id, c.label, 'reset'))),
    h('div', { class: 'timer-group', 'aria-label': 'Events' }, EVENTS.map((e) => timer(e.id, e.name, 'event'))));
}

function tickTimers(now: number): void {
  for (const c of countdowns) {
    const at = c.next(now);
    const el = $(`#timer-${c.id}`);
    $('.timer-value', el).textContent = formatDuration(at - now);
    el.title = `${c.label}: ${formatLocalTime(at)} your time`;
  }
  for (const event of EVENTS) {
    const status = eventStatus(event, now);
    const el = $(`#timer-${event.id}`);
    el.classList.toggle('is-open', status.open);
    $('.timer-value', el).textContent = status.open
      ? `${event.openLabel} · ${formatDuration(status.at - now)}`
      : `in ${formatDuration(status.at - now)}`;
    el.title = status.open ? `${event.name} closes ${formatLocalTime(status.at)}` : `${event.name} starts ${formatLocalTime(status.at)} your time`;
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-countdown]')) {
    const countdown = countdowns.find((c) => c.id === el.dataset['countdown']);
    if (!countdown) continue;
    const at = countdown.next(now);
    el.textContent = `Resets in ${formatDuration(at - now)}`;
    el.title = formatLocalTime(at);
  }
}

// ---------- characters ----------

function avatar(c: { name?: string; portrait?: string | undefined }, size = ''): HTMLElement {
  const initial = h('span', { class: `avatar avatar-initial ${size}`, 'aria-hidden': 'true' }, (c.name || '?').slice(0, 1).toUpperCase());
  if (!c.portrait) return initial;
  return h('img', {
    class: `avatar ${size}`,
    src: c.portrait,
    alt: '',
    loading: 'lazy',
    decoding: 'async',
    onerror: (e: Event) => (e.currentTarget as Element).replaceWith(initial),
  });
}

const characterMeta = (c: Character): string =>
  [c.className, c.level ? `Lv ${c.level}` : null, c.serverName].filter(Boolean).join(' · ');

function miniBar(label: string, { done, total }: { done: number; total: number }): HTMLSpanElement {
  return h('span', { class: 'mini', title: `${label}: ${done} of ${total} done` },
    h('span', { class: 'mini-label' }, label.slice(0, 1)),
    h('span', { class: 'mini-track' }, h('span', { class: 'mini-fill', style: { '--p': total ? done / total : 0 } })));
}

function renderRoster(): void {
  clear($('#roster'),
    state.characters.map((c) => {
      const isActive = c.id === state.activeId;
      return h('div', { class: `char${isActive ? ' is-active' : ''}` },
        h('button', {
          class: 'char-select',
          type: 'button',
          'aria-pressed': String(isActive),
          onclick: () => selectCharacter(c.id),
        },
          avatar(c),
          h('span', { class: 'char-text' },
            h('span', { class: 'char-name' }, c.name),
            h('span', { class: 'char-meta' }, characterMeta(c) || (c.placeholder ? 'Add yours to track alts' : 'Not linked')),
            h('span', { class: 'char-bars' },
              miniBar('Daily', store.periodSummary(state, c.id, 'daily')),
              miniBar('Weekly', store.periodSummary(state, c.id, 'weekly'))))),
        h('button', {
          class: 'char-more icon-button',
          type: 'button',
          'aria-label': `Manage ${c.name}`,
          title: 'Manage',
          onclick: () => openCharacterDialog(c.id),
        }, '⋯'));
    }),
    h('button', { class: 'char-add', type: 'button', onclick: () => openAddDialog() },
      h('span', { class: 'char-add-plus', 'aria-hidden': 'true' }, '+'),
      h('span', {}, 'Add character')));
}

function selectCharacter(id: string): void {
  state.activeId = id;
  commit();
  renderRoster();
  renderChecklist();
}

async function refreshCharacter(id: string, { quiet = false } = {}): Promise<void> {
  const c = state.characters.find((x) => x.id === id);
  if (!c?.characterId) return;
  try {
    const info = await api.character(c);
    store.updateCharacter(state, id, { ...info, updatedAt: Date.now() });
    commit();
    renderRoster();
    if (charDialogId === id) renderCharacterDialog();
    if (!quiet) toast(`${info.name} is up to date`);
  } catch (err) {
    if (!quiet) toast(errorMessage(err));
  }
}

// ---------- add character dialog ----------

let linkTarget: string | null = null; // set when linking an existing hand-added character to NCSOFT
let searchToken = 0;

function openAddDialog({ link = null, name = '' }: { link?: string | null; name?: string } = {}): void {
  linkTarget = link;
  const form = $<HTMLFormElement>('#search-form');
  control(form, 'region').value = state.ui.region;
  const nameInput = control(form, 'name');
  nameInput.value = name;
  $('#add-title').textContent = link ? 'Link to NCSOFT' : 'Add a character';
  $('#manual-add').hidden = Boolean(link);
  clear($('#search-results'));
  $<HTMLDialogElement>('#add-dialog').showModal();
  nameInput.focus();
}

async function onSearch(e: Event): Promise<void> {
  e.preventDefault();
  const form = e.currentTarget as HTMLFormElement;
  const picked = control<HTMLSelectElement>(form, 'region').value;
  const region = store.REGIONS.find((r) => r.id === picked)?.id ?? state.ui.region;
  const name = control(form, 'name').value.trim();
  if (!name) return;
  state.ui.region = region;
  commit();

  const results = $('#search-results');
  const token = ++searchToken;
  clear(results, h('p', { class: 'muted' }, 'Searching…'));
  try {
    const { results: list, total } = await api.search(region, name);
    if (token !== searchToken) return;
    if (!list.length) {
      clear(results, h('p', { class: 'muted' }, `No one named “${name}” on ${regionLabel(region)}. Check the spelling and region.`));
      return;
    }
    clear(results,
      h('ul', { class: 'search-list' }, list.map(searchRow)),
      total > list.length && h('p', { class: 'muted small' }, `Showing ${list.length} of ${total}. Type more of the name to narrow it down.`));
  } catch (err) {
    if (token === searchToken) clear(results, h('p', { class: 'error' }, errorMessage(err)));
  }
}

function searchRow(r: SearchHit): HTMLLIElement {
  const already = state.characters.some((c) => store.sameCharacter(c, r));
  return h('li', { class: 'search-row' },
    avatar(r),
    h('div', { class: 'search-text' },
      h('span', { class: 'search-name' }, r.name),
      h('span', { class: 'muted small' }, [r.className, `Lv ${r.level}`, r.serverName, r.race].filter(Boolean).join(' · '))),
    h('button', {
      class: 'button small',
      type: 'button',
      disabled: already && !linkTarget,
      onclick: () => pickCharacter(r),
    }, already && !linkTarget ? 'Added' : linkTarget ? 'Link' : 'Add'));
}

function pickCharacter(r: SearchHit): void {
  const info = { ...r, updatedAt: Date.now() };
  const target = linkTarget;
  let character: Character | null;
  if (target && state.characters.some((c) => c.id === target)) {
    const duplicate = state.characters.find((c) => c.id !== target && store.sameCharacter(c, r));
    if (duplicate) {
      toast(`${duplicate.name} is already in your list`);
      return;
    }
    character = store.updateCharacter(state, target, info);
    if (character) state.activeId = character.id;
  } else {
    character = store.addCharacter(state, info);
  }
  if (!character) return;
  commit();
  $<HTMLDialogElement>('#add-dialog').close();
  const charDialog = $<HTMLDialogElement>('#char-dialog');
  if (charDialog.open) charDialog.close();
  renderRoster();
  renderChecklist();
  toast(`${character.name} added`);
  void refreshCharacter(character.id, { quiet: true });
}

function onManualAdd(e: Event): void {
  e.preventDefault();
  const form = e.currentTarget as HTMLFormElement;
  const name = control(form, 'manualName').value.trim();
  if (!name) return;
  const character = store.addCharacter(state, { name, manual: true });
  commit();
  form.reset();
  $<HTMLDialogElement>('#add-dialog').close();
  renderRoster();
  renderChecklist();
  toast(`${character.name} added`);
}

// ---------- manage character dialog ----------

let charDialogId: string | null = null;

function openCharacterDialog(id: string): void {
  charDialogId = id;
  renderCharacterDialog();
  $<HTMLDialogElement>('#char-dialog').showModal();
}

function renderCharacterDialog(): void {
  const c = state.characters.find((x) => x.id === charDialogId);
  if (!c) {
    $<HTMLDialogElement>('#char-dialog').close();
    return;
  }
  const index = state.characters.indexOf(c);
  const stat = (label: string, value: string | number) => h('div', { class: 'stat' }, h('dt', {}, label), h('dd', {}, value));

  clear($('#char-body'),
    h('div', { class: 'char-detail' },
      avatar(c, 'large'),
      h('div', {},
        h('h2', { id: 'char-title' }, c.name),
        h('p', { class: 'muted' }, characterMeta(c) || 'Added by hand, not linked to NCSOFT'),
        c.region && h('p', { class: 'muted small' }, [regionLabel(c.region), c.race].filter(Boolean).join(' · ')))),
    c.characterId && h('dl', { class: 'stats' },
      stat('Combat Power', number(c.combatPower)),
      stat('Item Level', number(c.itemLevel)),
      stat('Level', c.level ?? '—')),
    c.characterId && c.updatedAt && h('p', { class: 'muted small' }, `From NCSOFT, updated ${timeAgo(c.updatedAt)}`),
    !c.characterId && h('form', { class: 'inline-form', onsubmit: (e: Event) => renameCharacter(e, c.id) },
      h('label', { for: 'rename-input' }, 'Name'),
      h('input', { id: 'rename-input', name: 'charName', value: c.name, maxlength: 40, required: true, autocomplete: 'off' }),
      h('button', { class: 'button small', type: 'submit' }, 'Save')),
    h('div', { class: 'dialog-actions' },
      c.characterId
        ? h('button', { class: 'button', type: 'button', onclick: () => refreshCharacter(c.id) }, 'Refresh from NCSOFT')
        : h('button', { class: 'button', type: 'button', onclick: () => openAddDialog({ link: c.id, name: c.placeholder ? '' : c.name }) }, 'Link to NCSOFT'),
      h('button', { class: 'button ghost', type: 'button', disabled: index === 0, onclick: () => moveCharacter(c.id, -1) }, 'Move left'),
      h('button', { class: 'button ghost', type: 'button', disabled: index === state.characters.length - 1, onclick: () => moveCharacter(c.id, 1) }, 'Move right'),
      h('button', { class: 'button danger', type: 'button', onclick: () => removeCharacter(c.id) }, 'Remove')));
}

function renameCharacter(e: Event, id: string): void {
  e.preventDefault();
  const name = control(e.currentTarget as HTMLFormElement, 'charName').value.trim();
  if (!name) return;
  store.updateCharacter(state, id, { name });
  commit();
  renderRoster();
  renderChecklist();
  renderCharacterDialog();
}

function moveCharacter(id: string, delta: number): void {
  store.moveCharacter(state, id, delta);
  commit();
  renderRoster();
  renderCharacterDialog();
}

function removeCharacter(id: string): void {
  const c = state.characters.find((x) => x.id === id);
  if (!c) return;
  const before = structuredClone(state);
  store.removeCharacter(state, id);
  commit();
  $<HTMLDialogElement>('#char-dialog').close();
  renderRoster();
  renderChecklist();
  toast(`Removed ${c.name}`, {
    label: 'Undo',
    run: () => {
      state = before;
      commit();
      renderAll();
    },
  });
}

// ---------- checklist ----------

const cards = new Map<string, { card: HTMLElement; task: ResolvedTask }>(); // for the active character

function renderChecklist(): void {
  const c = active();
  cards.clear();
  if (!c) {
    clear($('#view-checklist'),
      h('div', { class: 'no-character' },
        h('h2', {}, 'Add a character to start'),
        h('p', { class: 'muted' }, 'Look yours up by name, or add one by hand. Each character keeps its own progress in this browser.'),
        h('button', { class: 'button', type: 'button', onclick: () => openAddDialog() }, 'Add character')));
    return;
  }
  const tasks = store.visibleTasks(state);
  clear($('#view-checklist'),
    h('div', { class: 'checklist-head' },
      h('h2', { class: 'checklist-title' }, c.name, h('span', { class: 'muted' }, '’s checklist')),
      h('button', { class: 'button ghost small', type: 'button', onclick: openTasksDialog }, 'Edit tasks')),
    PERIODS.map((period) => {
      const list = tasks.filter((t) => t.period === period.id);
      return h('section', { class: 'period', 'aria-labelledby': `period-${period.id}` },
        h('header', { class: 'period-head' },
          h('h3', { id: `period-${period.id}` }, period.label),
          h('span', { class: 'period-count', dataset: { summary: period.id } }),
          h('span', { class: 'period-reset muted', dataset: { countdown: period.id } })),
        list.length
          ? h('div', { class: 'task-grid' }, list.map((task) => taskCard(c, task)))
          : h('p', { class: 'empty muted' }, 'Nothing here. Add tasks with Edit tasks.'));
    }));
  updateSummaries();
  tickTimers(Date.now());
}

// Every task is a single checkbox: done or not. The stored count is still 0..max,
// so ticking a task fills it and backups made before this change still read right.
function taskCard(c: Character, task: ResolvedTask): HTMLElement {
  const card = h('article', { class: 'task' });
  const main = h('button', {
    class: 'task-main',
    type: 'button',
    onclick: () => toggle(task),
  },
    h('span', { class: 'task-icon-wrap' },
      h('img', { class: 'task-icon', src: iconURL(task.icon), alt: '', width: 48, height: 48, decoding: 'async' }),
      h('span', { class: 'task-check', 'aria-hidden': 'true' }, '✓')),
    h('span', { class: 'task-text' },
      h('span', { class: 'task-name' }, task.name, task.max > 1 && h('span', { class: 'task-times' }, `×${task.max}`))));

  // a mouse target only; the main button already toggles for keyboards and screen readers
  const box = h('button', { class: 'task-toggle', type: 'button', tabindex: '-1', 'aria-hidden': 'true', onclick: () => toggle(task) });
  card.append(main, h('div', { class: 'task-progress' }, box));
  cards.set(task.id, { card, task });
  refreshCard(c, task.id);
  return card;
}

function refreshCard(c: Character, taskId: string): void {
  const entry = cards.get(taskId);
  if (!entry) return;
  const { card, task } = entry;
  const done = store.getCount(state, c.id, task) >= task.max;
  card.classList.toggle('is-done', done);
  const main = $('.task-main', card);
  main.setAttribute('aria-pressed', String(done));
  main.setAttribute('aria-label', `${task.name}${task.max > 1 ? `, ${task.max} times` : ''}${done ? ', done. Click to undo.' : '. Click to mark done.'}`);
}

function toggle(task: ResolvedTask): void {
  const c = active();
  if (!c) return;
  set(c, task, store.getCount(state, c.id, task) >= task.max ? 0 : task.max);
}

function set(c: Character, task: ResolvedTask, value: number): void {
  const before = store.periodSummary(state, c.id, task.period);
  store.setCount(state, c.id, task, Math.min(MAX_COUNT, value));
  commit();
  refreshCard(c, task.id);
  updateSummaries();
  renderRoster();
  const after = store.periodSummary(state, c.id, task.period);
  if (after.total && after.done === after.total && before.done < after.total) {
    const label = PERIODS.find((p) => p.id === task.period)?.label.toLowerCase() ?? task.period;
    toast(`All ${label} tasks done for ${c.name}`);
  }
}

function updateSummaries(): void {
  const c = active();
  if (!c) return;
  for (const el of document.querySelectorAll<HTMLElement>('[data-summary]')) {
    const period = PERIODS.find((p) => p.id === el.dataset['summary'])?.id;
    if (!period) continue;
    const { done, total } = store.periodSummary(state, c.id, period);
    el.textContent = total ? `${done} of ${total} done` : '';
    el.classList.toggle('is-complete', total > 0 && done === total);
  }
}

// ---------- edit tasks dialog ----------

function openTasksDialog(): void {
  renderTasksDialog();
  $<HTMLDialogElement>('#tasks-dialog').showModal();
}

function renderTasksDialog(): void {
  const tasks = store.allTasks(state);
  const row = (task: ResolvedTask) => {
    const hidden = state.tasks.hidden.includes(task.id);
    return h('li', { class: `edit-row${hidden ? ' is-hidden' : ''}` },
      h('input', {
        type: 'checkbox',
        id: `show-${task.id}`,
        checked: !hidden,
        onchange: (e: Event) => {
          state.tasks.hidden = state.tasks.hidden.filter((id) => id !== task.id);
          if (!(e.currentTarget as HTMLInputElement).checked) state.tasks.hidden.push(task.id);
          saveTasks();
        },
      }),
      h('img', { src: iconURL(task.icon), alt: '', width: 32, height: 32 }),
      h('label', { for: `show-${task.id}`, class: 'edit-name' }, task.name),
      h('input', {
        class: 'edit-max',
        type: 'number',
        min: 1,
        max: MAX_COUNT,
        value: task.max,
        'aria-label': `${task.name} count`,
        onchange: (e: Event) => {
          const value = Math.max(1, Math.min(MAX_COUNT, Number.parseInt((e.currentTarget as HTMLInputElement).value, 10) || 1));
          const custom = task.custom ? state.tasks.custom.find((t) => t.id === task.id) : undefined;
          if (custom) custom.max = value;
          else state.tasks.max[task.id] = value;
          saveTasks();
        },
      }),
      task.custom
        ? h('button', {
          class: 'icon-button danger',
          type: 'button',
          'aria-label': `Delete ${task.name}`,
          title: 'Delete',
          onclick: () => {
            state.tasks.custom = state.tasks.custom.filter((t) => t.id !== task.id);
            saveTasks();
          },
        }, '×')
        : h('span', { class: 'edit-spacer' }));
  };

  clear($('#tasks-body'),
    PERIODS.map((period) => h('section', { class: 'edit-group' },
      h('h3', {}, period.label),
      h('ul', { class: 'edit-list' }, tasks.filter((t) => t.period === period.id).map(row)))),
    h('form', { class: 'add-task', onsubmit: onAddTask },
      h('h3', {}, 'Add a task'),
      h('div', { class: 'field-row' },
        h('label', { class: 'field grow' }, h('span', {}, 'Name'), h('input', { name: 'taskName', required: true, maxlength: 60, autocomplete: 'off', placeholder: 'e.g. Sanctuary raid' })),
        h('label', { class: 'field' }, h('span', {}, 'Resets'),
          h('select', { name: 'taskPeriod' }, PERIODS.map((p) => h('option', { value: p.id }, p.label)))),
        h('label', { class: 'field narrow' }, h('span', {}, 'Count'), h('input', { name: 'taskMax', type: 'number', min: 1, max: MAX_COUNT, value: 1, required: true }))),
      h('fieldset', { class: 'icon-picker' },
        h('legend', {}, 'Icon'),
        Object.entries(ICONS).map(([key, icon], i) => h('label', { class: 'icon-choice', title: icon.label },
          h('input', { type: 'radio', name: 'taskIcon', value: key, checked: i === 0 }),
          h('img', { src: iconURL(key), alt: icon.label, width: 40, height: 40, loading: 'lazy' })))),
      h('button', { class: 'button', type: 'submit' }, 'Add task')));
}

function onAddTask(e: Event): void {
  e.preventDefault();
  const form = e.currentTarget as HTMLFormElement;
  // the icon choices share a name, so they come back as a RadioNodeList
  const icon = form.elements.namedItem('taskIcon');
  const task = store.addCustomTask(state, {
    name: control(form, 'taskName').value.trim(),
    period: control<HTMLSelectElement>(form, 'taskPeriod').value,
    max: Number.parseInt(control(form, 'taskMax').value, 10) || 1,
    icon: icon instanceof RadioNodeList ? icon.value : '',
  });
  if (!task) return;
  saveTasks();
  toast(`Added ${task.name}`);
}

function saveTasks(): void {
  commit();
  renderTasksDialog();
  renderChecklist();
  renderRoster();
}

function restoreDefaultTasks(): void {
  const before = structuredClone(state.tasks);
  state.tasks = { hidden: [], max: {}, custom: state.tasks.custom };
  saveTasks();
  toast('Default tasks restored', {
    label: 'Undo',
    run: () => {
      state.tasks = before;
      saveTasks();
    },
  });
}

// ---------- backup ----------

function exportBackup(): void {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `aion2-checklist-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importBackup(e: Event): Promise<void> {
  const picker = e.currentTarget as HTMLInputElement;
  const file = picker.files?.[0];
  picker.value = '';
  if (!file) return;
  try {
    const imported = store.normalize(JSON.parse(await file.text()));
    const before = state;
    state = imported;
    commit();
    renderAll();
    toast(`Imported ${imported.characters.length} character${imported.characters.length === 1 ? '' : 's'}`, {
      label: 'Undo',
      run: () => {
        state = before;
        commit();
        renderAll();
      },
    });
  } catch (err) {
    toast(err instanceof SyntaxError ? 'That file isn’t valid JSON' : errorMessage(err));
  }
}

// ---------- tabs and routing ----------

const items = initItems({
  root: $('#view-items'),
  getState: () => state,
  commit,
});

const asTab = (value: string | undefined): Tab => (value === 'items' ? 'items' : 'checklist');

function showTab(tab: Tab, { updateHash = true } = {}): void {
  state.ui.tab = tab;
  commit();
  for (const button of document.querySelectorAll<HTMLElement>('[role="tab"]')) {
    const selected = button.dataset['tab'] === tab;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  $('#view-checklist').hidden = tab !== 'checklist';
  $('#view-items').hidden = tab !== 'items';
  if (tab === 'items') void items.show();
  if (updateHash) history.replaceState(null, '', tab === 'items' ? '#items' : location.pathname + location.search);
}

function route(): void {
  const key = location.hash.match(/^#item\/(.+)$/)?.[1];
  if (key) {
    showTab('items', { updateHash: false });
    void items.open(decodeURIComponent(key));
  } else if (location.hash === '#items') {
    showTab('items', { updateHash: false });
  } else if (location.hash === '#checklist') {
    showTab('checklist');
  }
}

// ---------- startup ----------

function renderAll(): void {
  renderRoster();
  renderChecklist();
  showTab(state.ui.tab, { updateHash: false });
}

function tick(): void {
  const now = Date.now();
  if (store.rolloverAll(state, now)) {
    commit();
    renderRoster();
    renderChecklist();
    toast('The game just reset, so your tasks were cleared.');
  }
  tickTimers(now);
}

function wireDialogs(): void {
  for (const dialog of document.querySelectorAll('dialog')) {
    // a click on the backdrop lands on the dialog element itself
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
  }
  for (const button of document.querySelectorAll('[data-close]')) {
    button.addEventListener('click', () => button.closest('dialog')?.close());
  }
  $('#char-dialog').addEventListener('close', () => (charDialogId = null));
  $('#search-form').addEventListener('submit', onSearch);
  $('#manual-form').addEventListener('submit', onManualAdd);
  $('#restore-tasks').addEventListener('click', restoreDefaultTasks);
}

function wireTabs(): void {
  const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
  for (const tab of tabs) {
    tab.addEventListener('click', () => showTab(asTab(tab.dataset['tab'])));
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const next = tabs[(tabs.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      if (!next) return;
      next.focus();
      showTab(asTab(next.dataset['tab']));
    });
  }
}

buildTimers();
wireDialogs();
wireTabs();
$('#export-backup').addEventListener('click', exportBackup);
$('#import-backup').addEventListener('change', importBackup);
$('#reset-hint').textContent = `Resets daily at ${new Date(nextDailyReset()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} your time (07:00 UTC), weekly on Wednesdays.`;

renderAll();
route();
tick();
setInterval(tick, 1000);

window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) tick();
});
// keep tabs in sync when the checklist is open in more than one
window.addEventListener('storage', (e) => {
  if (e.key !== store.STORAGE_KEY) return;
  state = store.loadState();
  renderRoster();
  renderChecklist();
  items.refresh();
});

// keep linked characters' combat power and level current, without hammering the lookup
const STALE_MS = 6 * 60 * 60 * 1000;
state.characters
  .filter((c) => c.characterId && (!c.updatedAt || Date.now() - c.updatedAt > STALE_MS))
  .forEach((c, i) => setTimeout(() => refreshCharacter(c.id, { quiet: true }), 1500 + i * 1200));
