# Nimbus: web development service site

A one-page marketing site for a freelance web development service, built with Next.js (App Router) and plain CSS.

## Run it

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
```

## Edit the content

All copy lives in `src/content.ts`: brand name, contact email, services, process, sample projects, prices and FAQ. Layout is in `src/app/page.tsx` and styles in `src/app/globals.css`.

Before going live, replace:

- the sample projects in `work` with real case studies
- the prices in `plans` with your own
