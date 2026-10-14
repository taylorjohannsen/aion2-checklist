// The character window: a large dialog with one character's gear, skills and stats,
// fetched from NC through our relay. Hovering, focusing or tapping a piece of gear
// shows its full roll, fetched on demand so opening the window costs one lookup.
import { h, clear, avatar, number, type Child } from './dom.js';
import { api, type Armory, type CharacterInfo, type CharacterRef, type GearDetail, type GearPiece, type SkillInfo, type StatLine } from './api.js';
import { REGIONS } from './store.js';

type View = 'gear' | 'skills' | 'stats';

const VIEWS: { id: View; label: string }[] = [
  { id: 'gear', label: 'Equipment' },
  { id: 'skills', label: 'Skills' },
  { id: 'stats', label: 'Stats' },
];

// NC's slot numbers, grouped and labelled for the equipment tab
const ARMOR_SLOTS: [number, string][] = [
  [1, 'Main hand'], [2, 'Off hand'], [3, 'Helmet'], [4, 'Shoulders'], [5, 'Chest'],
  [6, 'Legs'], [7, 'Gloves'], [8, 'Boots'], [19, 'Cape'], [17, 'Belt'],
];
const ACCESSORY_SLOTS: [number, string][] = [
  [10, 'Necklace'], [11, 'Earring'], [12, 'Earring'], [13, 'Ring'], [14, 'Ring'],
  [15, 'Bracelet'], [16, 'Bracelet'], [22, 'Amulet'], [23, 'Rune'], [24, 'Rune'],
];
const ARCANA_SLOTS = [41, 42, 43, 44, 45];

const SKILL_GROUPS: { id: SkillInfo['group']; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'passive', label: 'Passive' },
  { id: 'stigma', label: 'Stigma' },
];

// Grades come from NC, so only plain words become class names
const gradeKey = (grade: string | undefined): string => (grade && /^[A-Za-z]+$/.test(grade) ? grade.toLowerCase() : '');
const gradeClass = (grade: string | undefined): string => (gradeKey(grade) ? `grade-${gradeKey(grade)}` : '');

export interface CharacterWindow {
  /** `preview` is whatever the caller already knows, shown while the lookup runs */
  open(ref: CharacterRef, preview?: { name?: string; portrait?: string }): void;
}

export function initCharacterWindow({ dialog, isTracked, track, onLoad, onClose }: {
  dialog: HTMLDialogElement;
  isTracked: (c: CharacterInfo) => boolean;
  track: (c: CharacterInfo) => void;
  /** a fresh lookup, so the roster can update a character it tracks */
  onLoad: (c: CharacterInfo) => void;
  onClose: () => void;
}): CharacterWindow {
  let ref: CharacterRef | null = null;
  let preview: { name?: string; portrait?: string } = {};
  let data: Armory | null = null;
  let error = '';
  let view: View = 'gear';
  let token = 0;
  const details = new Map<string, GearDetail | Promise<GearDetail>>();

  const body = h('div', { class: 'armory-body' });
  const tip = h('div', { class: 'gear-tip', id: 'gear-tip', role: 'tooltip', hidden: true });
  let tipFor: HTMLElement | null = null;
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  let hoverRow: HTMLElement | null = null;
  // The window can open under a resting mouse; hover only counts once it moves
  let mouseMoved = false;
  clear(dialog, body, tip);

  // capture, so it's set before the row under the mouse sees the same move
  dialog.addEventListener('pointermove', (e) => {
    if (e.movementX || e.movementY) mouseMoved = true;
  }, true);

  dialog.addEventListener('close', () => {
    hideTip();
    token++;
    onClose();
  });
  // Escape closes an open tooltip before the window
  dialog.addEventListener('cancel', (e) => {
    if (!tipFor) return;
    e.preventDefault();
    hideTip();
  });
  dialog.addEventListener('pointerdown', (e) => {
    if (tipFor && e.target instanceof Node && !tipFor.contains(e.target) && !tip.contains(e.target)) hideTip();
  });

  function open(next: CharacterRef, known: { name?: string; portrait?: string } = {}): void {
    ref = next;
    preview = known;
    data = null;
    error = '';
    render();
    if (!dialog.open) {
      mouseMoved = false;
      dialog.showModal();
    }
    void load();
  }

  async function load(): Promise<void> {
    if (!ref) return;
    const mine = ++token;
    try {
      const result = await api.armory(ref);
      if (mine !== token) return;
      data = result;
      onLoad(result.character);
    } catch (err) {
      if (mine !== token) return;
      error = err instanceof Error ? err.message : String(err);
    }
    render();
  }

  // ---------- layout ----------

  function render(): void {
    hideTip();
    const c = data?.character;
    clear(body,
      h('header', { class: 'armory-head' },
        avatar(c ?? preview, 'large'),
        h('div', { class: 'armory-who' },
          h('h2', { id: 'armory-name' }, c?.name ?? preview.name ?? ''),
          c && h('p', { class: 'muted' }, [`Lv ${c.level}`, c.className, c.serverName, REGIONS.find((r) => r.id === c.region)?.label, c.race].filter(Boolean).join(' · ')),
          c?.title && h('p', { class: `small ${gradeClass(c.title.grade)}` }, c.title.name)),
        c && h('dl', { class: 'armory-numbers' },
          h('div', {}, h('dt', {}, 'Combat Power'), h('dd', {}, number(c.combatPower))),
          h('div', {}, h('dt', {}, 'Item Level'), h('dd', {}, number(c.itemLevel)))),
        c && !isTracked(c) && h('div', { class: 'armory-actions' },
          h('button', {
            class: 'button small',
            type: 'button',
            onclick: () => {
              track(c);
              render();
            },
          }, 'Add to checklist')),
        h('button', { class: 'icon-button armory-close', type: 'button', 'aria-label': 'Close', onclick: () => dialog.close() }, '×')),
      h('div', { class: 'armory-tabs', role: 'tablist', 'aria-label': 'Character' },
        VIEWS.map((v) => h('button', {
          type: 'button',
          role: 'tab',
          id: `armory-tab-${v.id}`,
          'aria-selected': String(v.id === view),
          'aria-controls': 'armory-panel',
          tabindex: v.id === view ? 0 : -1,
          onclick: () => showView(v.id),
          onkeydown: (e: KeyboardEvent) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            const i = VIEWS.findIndex((x) => x.id === view);
            const next = VIEWS[(i + (e.key === 'ArrowRight' ? 1 : VIEWS.length - 1)) % VIEWS.length];
            if (next) showView(next.id, true);
          },
        }, v.label))),
      h('div', {
        class: 'armory-panel',
        id: 'armory-panel',
        role: 'tabpanel',
        'aria-labelledby': `armory-tab-${view}`,
        onscroll: () => hideTip(),
      }, panel()));
  }

  function showView(next: View, focus = false): void {
    view = next;
    render();
    if (focus) body.querySelector<HTMLElement>(`#armory-tab-${next}`)?.focus();
  }

  function panel(): Child {
    if (error) {
      return h('div', { class: 'armory-state' },
        h('p', { class: 'error' }, error),
        h('button', { class: 'button ghost small', type: 'button', onclick: () => { error = ''; render(); void load(); } }, 'Try again'));
    }
    if (!data) return h('p', { class: 'armory-state muted' }, 'Loading…');
    if (view === 'skills') return skillsPanel(data);
    if (view === 'stats') return statsPanel(data);
    return gearPanel(data);
  }

  // ---------- equipment ----------

  function gearPanel(a: Armory): HTMLElement {
    const bySlot = new Map(a.gear.map((g) => [g.slot, g]));
    const known = new Set([...ARMOR_SLOTS, ...ACCESSORY_SLOTS].map(([slot]) => slot).concat(ARCANA_SLOTS));
    const others = a.gear.filter((g) => !known.has(g.slot));
    return h('div', { class: 'gear' },
      h('section', { class: 'gear-group' },
        h('h3', { class: 'list-title' }, 'Gear'),
        ARMOR_SLOTS.map(([slot, label]) => slotRow(bySlot.get(slot), label))),
      h('section', { class: 'gear-group' },
        h('h3', { class: 'list-title' }, 'Accessories'),
        ACCESSORY_SLOTS.map(([slot, label]) => slotRow(bySlot.get(slot), label)),
        others.map((g) => slotRow(g, g.slotName))),
      h('section', { class: 'gear-group gear-wide' },
        h('h3', { class: 'list-title' }, 'Arcana'),
        h('div', { class: 'gear-row' }, ARCANA_SLOTS.map((slot) => slotRow(bySlot.get(slot), 'Arcana')))),
      (a.wing || a.pet) && h('section', { class: 'gear-group gear-wide' },
        h('h3', { class: 'list-title' }, 'Wings and pet'),
        h('div', { class: 'gear-row' },
          a.wing && plainRow(a.wing.icon, a.wing.name, a.wing.grade, 'Wings', a.wing.enchant),
          a.pet && plainRow(a.pet.icon, a.pet.name, '', `Pet · Lv ${a.pet.level}`, 0))));
  }

  function gearIcon(icon: string, grade: string, enchant: number): HTMLElement {
    return h('span', { class: 'gear-icon', style: { '--tone': gradeKey(grade) ? `var(--grade-${gradeKey(grade)})` : 'var(--border-strong)' } },
      icon && h('img', { src: icon, alt: '', loading: 'lazy', decoding: 'async' }),
      enchant > 0 && h('span', { class: 'gear-enchant' }, `+${enchant}`));
  }

  function slotText(name: string, grade: string, label: string): HTMLElement {
    return h('span', { class: 'gear-text' },
      h('span', { class: `gear-name ${gradeClass(grade)}` }, name),
      h('span', { class: 'gear-label' }, label));
  }

  function plainRow(icon: string, name: string, grade: string, label: string, enchant: number): HTMLElement {
    return h('div', { class: 'gear-slot is-static' }, gearIcon(icon, grade, enchant), slotText(name, grade, label));
  }

  function slotRow(piece: GearPiece | undefined, label: string): HTMLElement {
    if (!piece) {
      return h('div', { class: 'gear-slot is-empty' }, h('span', { class: 'gear-icon' }), slotText('Empty', '', label));
    }
    const row = h('button', { class: 'gear-slot', type: 'button' },
      gearIcon(piece.icon, piece.grade, piece.enchant),
      slotText(piece.name, piece.grade, label));
    // pointermove rather than pointerenter, so a row the mouse was resting on when the
    // window opened still responds once it moves
    row.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || !mouseMoved || tipFor === row || hoverRow === row) return;
      clearTimeout(hoverTimer);
      hoverRow = row;
      // a short wait, so sweeping the mouse across the grid doesn't fetch every piece
      hoverTimer = setTimeout(() => {
        hoverRow = null;
        showTip(row, piece);
      }, 120);
    });
    row.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(hoverTimer);
      hoverRow = null;
      hideTip(row);
    });
    row.addEventListener('click', () => showTip(row, piece));
    row.addEventListener('focus', () => {
      if (row.matches(':focus-visible')) showTip(row, piece);
    });
    row.addEventListener('blur', () => hideTip(row));
    return row;
  }

  // ---------- gear tooltip ----------

  function showTip(row: HTMLElement, piece: GearPiece): void {
    if (!ref) return;
    tipFor?.removeAttribute('aria-describedby');
    tipFor = row;
    row.setAttribute('aria-describedby', tip.id);
    const key = [ref.region, ref.serverId, ref.characterId, piece.slot, piece.id, piece.enchant].join('/');
    const known = details.get(key);
    if (known && !(known instanceof Promise)) {
      fillTip(piece, known);
      return;
    }
    fillTip(piece, null);
    let pending = known;
    if (!pending) {
      pending = api.gear(ref, piece).then(
        (detail) => {
          details.set(key, detail);
          return detail;
        },
        (err: unknown) => {
          details.delete(key);
          throw err;
        });
      details.set(key, pending);
    }
    pending.then(
      (detail) => {
        if (tipFor === row) fillTip(piece, detail);
      },
      () => {
        if (tipFor === row) fillTip(piece, null, true);
      });
  }

  function hideTip(row?: HTMLElement): void {
    if (!row) {
      // re-renders and scrolls also drop a hover that hasn't shown yet
      clearTimeout(hoverTimer);
      hoverRow = null;
    }
    if (row && tipFor !== row) return;
    tipFor?.removeAttribute('aria-describedby');
    tipFor = null;
    tip.hidden = true;
  }

  function fillTip(piece: GearPiece, d: GearDetail | null, failed = false): void {
    const enchant = piece.enchant || d?.maxEnchant ? `+${piece.enchant}${d?.maxEnchant ? ` / ${d.maxEnchant}` : ''}` : '';
    const line = (name: string, value: string, extra = '', grade = '') =>
      h('div', { class: 'tip-line' },
        h('span', { class: gradeClass(grade) }, name),
        h('span', { class: 'tip-value' }, value, extra && h('span', { class: 'tip-extra' }, ` ${extra}`)));
    const section = (title: string | null, ...children: Child[]) =>
      h('div', { class: 'tip-section' }, title && h('p', { class: 'tip-title' }, title), children);
    const set = d?.set;
    clear(tip,
      h('div', { class: 'tip-head' },
        gearIcon(piece.icon, piece.grade, 0),
        h('div', {},
          h('p', { class: `tip-name ${gradeClass(piece.grade)}` }, piece.name),
          h('p', { class: 'muted small' }, [d?.category, piece.grade, enchant, piece.exceed > 0 && `Exceed ${piece.exceed}`].filter(Boolean).join(' · ')))),
      !d && h('p', { class: 'muted small' }, failed ? 'Couldn’t load the details' : 'Loading…'),
      d && d.mainStats.length > 0 && section(null,
        // the enchant bonus, which NC sends as "0" or "0%" when there is none
        d.mainStats.map((s) => line(s.name, s.value, parseFloat(s.extra) ? `+${s.extra}` : ''))),
      d && d.subStats.length > 0 && section('Bonus stats', d.subStats.map((s) => line(s.name, `+${s.value}`))),
      d && d.manastones.length > 0 && section('Manastones', d.manastones.map((s) => line(s.name, s.value, '', s.grade))),
      d?.godstones.map((g) => section(null,
        h('p', { class: `tip-strong ${gradeClass(g.grade)}` }, g.name),
        h('p', { class: 'tip-desc' }, g.desc))),
      d && d.subSkills.length > 0 && section('Skills', d.subSkills.map((s) => line(s.name, `Lv ${s.level}`))),
      set && section(`${set.name} · ${set.equipped}/${set.total}`,
        set.bonuses.map((b) => h('p', { class: `tip-bonus${b.count <= set.equipped ? ' is-active' : ''}` },
          h('span', { class: 'tip-count' }, String(b.count)),
          h('span', {}, b.text.join(' '))))));
    tip.hidden = false;
    if (tipFor) place(tipFor);
  }

  // Beside the row when there's room, otherwise below or above it
  function place(row: HTMLElement): void {
    const r = row.getBoundingClientRect();
    const w = tip.offsetWidth;
    const ht = tip.offsetHeight;
    const gap = 10;
    let left = r.right + gap;
    if (left + w > innerWidth - 8) left = r.left - w - gap;
    let top: number;
    if (left < 8) {
      left = Math.min(Math.max(8, r.left), innerWidth - w - 8);
      top = r.bottom + gap;
      if (top + ht > innerHeight - 8) top = Math.max(8, r.top - ht - gap);
    } else {
      top = Math.min(Math.max(8, r.top), innerHeight - ht - 8);
    }
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  // ---------- skills ----------

  function skillsPanel(a: Armory): HTMLElement {
    if (!a.skills.length) return h('p', { class: 'armory-state muted' }, 'No skills learned');
    return h('div', { class: 'skills' },
      SKILL_GROUPS.map((g) => {
        const skills = a.skills.filter((s) => s.group === g.id);
        return skills.length > 0 && h('section', {},
          h('h3', { class: 'list-title' }, g.label),
          h('ul', { class: 'skill-list' }, skills.map((s) =>
            h('li', { class: 'skill' },
              s.icon && h('img', { src: s.icon, alt: '', loading: 'lazy', decoding: 'async' }),
              h('span', { class: 'skill-name' }, s.name),
              h('span', { class: 'skill-level' }, `Lv ${s.level}`)))));
      }));
  }

  // ---------- stats ----------

  function statsPanel(a: Armory): HTMLElement {
    const card = (s: StatLine) =>
      h('div', { class: 'stat-card' },
        h('div', { class: 'stat-card-top' },
          h('span', { class: 'stat-card-name' }, s.name, s.god && h('span', { class: 'muted' }, ` · ${s.god}`)),
          h('span', { class: 'stat-card-value' }, s.value)),
        s.effects.length > 0 && h('ul', { class: 'stat-effects' }, s.effects.map((e) => h('li', {}, e))));
    const group = (title: string, stats: StatLine[]) => stats.length > 0 && h('section', {},
      h('h3', { class: 'list-title' }, title),
      h('div', { class: 'stat-grid' }, stats.map(card)));
    return h('div', { class: 'stat-panels' },
      group('Primary', a.stats.filter((s) => s.group === 'primary')),
      group('Deity', a.stats.filter((s) => s.group === 'deity')));
  }

  return { open };
}
