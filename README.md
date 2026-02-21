# 🌿 IrigaPro Web — Next.js + Supabase + Vercel

Aplicație web completă pentru proiectarea sistemelor de irigații.

---

## Stack

| Componentă | Tehnologie | Cost |
|------------|-----------|------|
| Frontend   | Next.js 14 + TypeScript + Tailwind | Gratuit |
| Backend    | Supabase (PostgreSQL + Auth + RLS) | Gratuit până la 50k utilizatori |
| Hosting    | Vercel | Gratuit |
| Domeniu    | Cloudflare / orice registrar | ~10€/an |

---

## Setup în 5 pași

### 1. Creează proiect Supabase

1. Mergi la [supabase.com](https://supabase.com) → New Project
2. Alege un nume (ex: `irigapro`) și o regiune (EU West - Frankfurt)
3. Notează **Project URL** și **anon public key** din Settings → API

### 2. Rulează schema SQL

1. În Supabase Dashboard → SQL Editor → New Query
2. Copiază tot conținutul din `supabase-schema.sql`
3. Click **Run** — creează tabelele, politicile RLS și seed-uiește aspersoarele

### 3. Configurează variabilele de mediu

```bash
cp .env.local.example .env.local
```

Editează `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
```

### 4. Rulează local

```bash
npm install
npm run dev
# → http://localhost:3000
```

### 5. Deploy pe Vercel

```bash
# Instalează Vercel CLI
npm i -g vercel

# Deploy
vercel

# Adaugă env vars în Vercel dashboard sau:
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
```

Sau conectează direct repo-ul GitHub la Vercel și se deployează automat la fiecare push.

---

## Activare Google OAuth (opțional)

1. Supabase Dashboard → Authentication → Providers → Google → Enable
2. Creează OAuth credentials în [Google Cloud Console](https://console.cloud.google.com)
3. Callback URL: `https://xxxx.supabase.co/auth/v1/callback`
4. Adaugă Client ID + Secret în Supabase

---

## Structura proiectului

```
src/
├── app/
│   ├── page.tsx                    # Landing page
│   ├── auth/
│   │   ├── login/page.tsx          # Login
│   │   ├── register/page.tsx       # Register
│   │   └── callback/route.ts       # OAuth callback
│   ├── dashboard/
│   │   ├── page.tsx                # Server component (auth check)
│   │   └── DashboardClient.tsx     # Project list + create
│   ├── simulator/[id]/
│   │   ├── page.tsx                # Server component (load project)
│   │   └── SimulatorClient.tsx     # Full canvas simulator
│   └── api/
│       └── projects/
│           ├── route.ts            # GET list, POST create
│           └── [id]/route.ts       # GET, PATCH, DELETE
├── lib/supabase/
│   ├── client.ts                   # Browser client
│   └── server.ts                   # Server client
├── middleware.ts                   # Auth redirect logic
└── types/index.ts                  # TypeScript types
```

---

## Funcționalități

- ✅ Autentificare email + Google OAuth
- ✅ Dashboard cu proiecte salvate în cloud
- ✅ Simulator canvas interactiv (orice formă poligonală)
- ✅ 28 modele aspersoare (Rain Bird, Hunter, Toro, Generic)
- ✅ Plasare automată S→S
- ✅ Trasee conducte MST automat
- ✅ Animație simulare cu particule
- ✅ Salvare automată în Supabase
- ✅ Row Level Security — fiecare user vede doar proiectele lui
- ✅ Proiecte publice cu link de partajare

---

## Upgrade viitor (monetizare)

- Export PDF schemă tehnică → €5/export sau plan Pro
- Colaborare pe proiect cu client → plan Pro
- Baza de date aspersoare premium (prețuri, disponibilitate RO) → plan Pro
- Stripe integration: `npm install @stripe/stripe-js`

---

## Suport

Ionel Aumovio | Timișoara | www.aumovio.ro
