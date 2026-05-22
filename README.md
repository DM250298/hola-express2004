# Hola Express — Sistema de Gestión

Sistema de gestión operativa para **Hola Express**, un autoservicio 24 horas en
La Rioja, Argentina. Reemplaza el control manual de ventas, inventario y
vencimientos por una aplicación web moderna, usada por hasta 15 empleados con
distintos niveles de acceso.

## Stack

| Capa | Tecnología |
|------|-----------|
| Framework | Next.js 16 (App Router) |
| Lenguaje | TypeScript estricto |
| UI | Tailwind CSS + shadcn/ui |
| Base de datos | Supabase (PostgreSQL + Auth + RLS) |
| Data fetching | TanStack Query v5 |
| Deploy | Vercel |

## Módulos

POS (con modo offline) · Inventario · Vencimientos · Pedidos y Recepción ·
Compras · Etiquetas de precio · Finanzas · Contabilidad · RR.HH. / Nóminas ·
CRM (clientes) · Proyectos · Reportes · Terminales de cobro · Configuración.

---

## Variables de entorno

Copiá `.env.example` a `.env.local` y completá los valores:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...          # solo servidor
MP_ACCESS_TOKEN=APP_USR-...               # opcional — terminales Mercado Pago Point
```

Los valores de Supabase están en: *Settings → API* del proyecto en supabase.com.

## Desarrollo local

```bash
npm install
npm run dev
```

Abrí http://localhost:3000

> El service worker (modo offline del POS) **solo se registra en producción**.
> En desarrollo, el catálogo offline y la cola de ventas se pueden probar
> activando "Offline" en las DevTools del navegador.

## Base de datos

El esquema vive en `supabase/`:

- `supabase/schema.sql` — esquema base.
- `supabase/migrations/` — migraciones numeradas (001, 002, …). Se ejecutan
  **una sola vez, en orden**, en el *SQL Editor* de Supabase.

Al clonar el proyecto contra una base nueva, correr el `schema.sql` y luego
todas las migraciones en orden.

---

## Deploy a Vercel

El deploy es continuo: una vez conectado, **cada push a la rama principal se
publica solo**.

### 1. Subir el código a GitHub

```bash
git init            # si todavía no es un repo
git add .
git commit -m "Hola Express"
git branch -M main
git remote add origin https://github.com/USUARIO/REPO.git
git push -u origin main
```

Verificá que `.env.local` esté en `.gitignore` — **nunca se sube**.

### 2. Conectar el repo a Vercel

1. Entrá a [vercel.com](https://vercel.com) → **Add New… → Project**.
2. Importá el repositorio de GitHub.
3. Vercel detecta Next.js automáticamente — no hace falta tocar la configuración
   de build.

### 3. Cargar las variables de entorno en Vercel

En *Settings → Environment Variables* del proyecto, cargá:

| Variable | Notas |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Pública |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Pública |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secreta** — sin el prefijo `NEXT_PUBLIC_` |
| `MP_ACCESS_TOKEN` | **Secreta** — opcional, para las terminales de cobro |

### 4. Deploy

Vercel publica y entrega una URL: `https://tu-app.vercel.app`.

### 5. Configurar Auth en Supabase

En Supabase → *Authentication → URL Configuration*, agregá la URL de Vercel
como **Site URL** y como **Redirect URL**.

> ⚠️ Sin este paso, el login no funciona en producción.

### 6. Verificar después del deploy

- Login desde otro dispositivo.
- POS en tablet + modo offline real (cortar wifi, vender, reconectar).
- Instalar la PWA en la tablet ("Agregar a pantalla de inicio").

---

## Comandos

```bash
npm run dev      # servidor de desarrollo
npm run build    # build de producción (verificar antes de cambios grandes)
npm run start    # servir el build de producción localmente
```
