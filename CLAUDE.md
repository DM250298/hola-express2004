# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> ⚠️ **This is Next.js 16, not Next.js 13/14.** APIs, conventions, and file structure may differ from training data. Read `node_modules/next/dist/docs/` before writing routing or data-fetching code. Heed deprecation notices.

---

## Commands

```bash
npm run dev      # start dev server
npm run build    # production build (runs TypeScript check)
npm run start    # serve production build
```

No test runner or linter is configured. TypeScript errors surface at build time (`npm run build`).

---

## Architecture

### Stack
- **Next.js 16** (App Router) + **React 19** + **TypeScript strict**
- **Supabase** (`@supabase/ssr` v0.10) — PostgreSQL + Auth + RLS
- **TanStack Query v5** — all client-side data fetching and mutations
- **Tailwind CSS v4** + **shadcn/ui** (built on `@base-ui/react`, not Radix)
- **Zod v4** + **react-hook-form v7** — form validation
- **sonner** — toast notifications

### Route structure
All authenticated pages live under `app/(dashboard)/`. The layout at `app/(dashboard)/layout.tsx` is a **Server Component** that reads the Supabase session and user permissions, then passes them to `<Sidebar>` and `<Header>`. There is no client-side auth check — if the layout renders, the user is authenticated.

Routes: `/` (dashboard), `/pos`, `/ventas`, `/inventario`, `/vencimientos`, `/pedidos`, `/recepcion`, `/compras`, `/etiquetas`, `/finanzas`, `/contabilidad`, `/rrhh`, `/clientes`, `/tableros`, `/proyectos`, `/agenda`, `/reportes`, `/terminales`, `/configuracion`.

### Supabase client usage
- **Server Components / layouts**: `createServerClient()` from `@/lib/supabase/server`
- **Client Components / hooks / queries**: `createClient()` from `@/lib/supabase/client`
- Never mix them. The server client reads cookies via Next.js headers; the browser client uses `createBrowserClient` from `@supabase/ssr`.

### Data layer pattern
Every feature follows this layering:

```
lib/queries/<feature>.ts      ← raw Supabase calls, typed with Database types
lib/hooks/use<Feature>.ts     ← TanStack Query wrappers (useQuery / useMutation)
components/<feature>/         ← UI consumes hooks only, never queries directly
```

Mutations that need atomicity (create sale, void sale, run payroll) call **Postgres RPCs** (`supabase.rpc('fn_...')`) instead of multiple client-side inserts. This is the critical pattern for financial operations.

### Permission system
Permissions are string keys defined in `lib/permisos.ts`. Each user has a `rol` in `usuarios` table; each role has a `permisos: string[]` array in the `roles` table (with a legacy fallback in `PERMISOS_POR_ROL_LEGACY`).

- **Middleware** (`middleware.ts`): enforces route-level access using `PERMISO_RUTA` (permiso → array of route prefixes). Redirects unauthorized users to `/`.
- **Layout**: reads permisos from DB and passes them down as props to `<Sidebar>` and `<Header>`.
- **RLS**: Supabase Row Level Security provides the actual security boundary at the DB level.

To add a new protected route: add the permiso key to `PERMISOS` in `lib/permisos.ts`, add the route prefix to `PERMISO_RUTA` in `middleware.ts`, and assign it to roles in the `roles` table.

### Offline mode (POS only)
The POS supports offline sales via `lib/offline/`:
- `db.ts` — IndexedDB schema using `idb`
- `cola.ts` — queues sales when offline (`encolarVenta`)
- `sync.ts` — re-sends queued sales when connectivity returns (`esErrorDeRed` detects network errors)
- `catalogo.ts` — caches product catalog for offline search

Sales go through `crearVenta` in `lib/queries/ventas.ts` which checks `navigator.onLine` and falls back to the queue. Queued sales are returned as `pendiente: true` so the POS can still print a ticket.

### Database migrations
Migrations live in `supabase/migrations/` numbered sequentially (e.g. `039_cuenta_corriente_empleado.sql`). There is no migration runner in the codebase — run migrations manually via the Supabase Dashboard SQL Editor or `supabase db push`. Never modify existing migrations; always add a new numbered file.

Types in `types/database.ts` are manually maintained (not auto-generated). Use `type` aliases (not `interface`) and include `Relationships` and `CompositeTypes` keys to avoid `never[]` errors from `@supabase/supabase-js` v2.105+.

---

## Key conventions

- **Language**: all variable names, comments, and UI text in Spanish (Argentine business context).
- **Dates**: always `date-fns` with `es` locale. Utilities in `lib/utils/formato.ts`.
- **Currency**: `Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })`. Use the `<MontoARS monto={n} />` component.
- **`"use client"`**: only when the component uses state, effects, or event handlers. Layouts and data-display pages are Server Components by default.
- **shadcn `<Button>` without `asChild`**: this build uses `@base-ui/react` under shadcn, which does not support `asChild`. Use `buttonVariants()` + a plain `<Link>` wrapper instead.
- **`<Select>` with `items` prop**: the local shadcn Select accepts an `items` prop (`Record<string, string>`) as a shorthand, in addition to the standard `<SelectItem>` children pattern.
- **Toasts**: import `toast` from `sonner`. Always show success/error toasts from mutation `onSuccess`/`onError` callbacks in the hook layer, not in components.
