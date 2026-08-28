# Referrals

Next.js 15 · React 19 · TypeScript · Tailwind 4

## Running it

```bash
pnpm install
pnpm dev        # http://localhost:3300
```

## Checks

```bash
pnpm typecheck  # tsc --noEmit
pnpm build      # production build; type errors fail it
pnpm verify     # both
```

CI runs `typecheck` then `build` on every push and pull request to `main`.

## Layout

```
app/
  layout.tsx    root layout, metadata, skip link
  page.tsx      the front page
  globals.css   Tailwind entry, palette tokens, reduced-motion reset
```

Both colour schemes are defined explicitly rather than only inside a `prefers-color-scheme`
query, and reduced motion is handled once at the root so a new component cannot forget it.
