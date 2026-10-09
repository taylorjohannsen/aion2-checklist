# AION 2 Checklist

Daily and weekly checklist for AION 2 Global, with character lookup and item search.

**Live at https://aion.taylorjohannsen.com**

- **Checklist:** one checkbox per task, per character. It clears itself at the
  daily reset (07:00 UTC) and the weekly reset (Wednesday 07:00 UTC), and the
  header counts down to both and to the hourly events.
- **Characters:** look yours up by name to pull its class, level, combat power
  and item level.
- **Items:** search about 3,500 items to see where they come from, and keep
  your own notes.

Progress is saved in your browser. There are no accounts.

## Development

Needs Node 18 or newer.

```sh
npm install
npm start              # build, then serve http://127.0.0.1:3005
npm run typecheck
npm run build:items    # rebuild the item index (slow; cached in scripts/.cache)
```

Shop prices and sources are hand-written in `public/data/sources.json`.
