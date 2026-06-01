# 🗄️ Supabase Setup — bot v7

Storage persistent gratuit pentru bot. Înlocuiește `/tmp/conversations.json` din v6
care se șterge la fiecare hibernare Render.

**Timp setup: 10 minute. Cost: 0 EUR (free tier 500MB permanent).**

---

## Pas 1 — Cont Supabase

1. Mergi la https://supabase.com
2. **Sign in** → autentificare cu GitHub (cea mai rapidă)
3. **New Project**:
   - **Name:** `motiv-kommo-bot`
   - **Database Password:** generează puternică (salvează într-un manager parole)
   - **Region:** `Central EU (Frankfurt)` — cel mai aproape de România
   - **Pricing Plan:** Free
4. Click **Create new project** → aștepți 1-2 minute să provisioneze

---

## Pas 2 — Creezi cele 3 tabele necesare

Mergi în Supabase Dashboard → **SQL Editor** → **New query** → paste codul de mai jos → **Run**:

```sql
-- ─── messages ─────────────────────────────────────────────────────────────
-- Stochează istoricul conversațiilor (incoming + outgoing)
CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  talk_id TEXT NOT NULL,
  lead_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('incoming', 'outgoing')),
  text TEXT NOT NULL,
  author TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_talk_id ON messages(talk_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_lead_id ON messages(lead_id) WHERE lead_id IS NOT NULL;

-- ─── processed_messages ───────────────────────────────────────────────────
-- Deduplicare composite (msg_id sau hash + minute bucket)
CREATE TABLE IF NOT EXISTS processed_messages (
  dedup_key TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_processed_created_at ON processed_messages(created_at);

-- ─── rate_limits ──────────────────────────────────────────────────────────
-- 1 răspuns / 60 sec / talk_id
CREATE TABLE IF NOT EXISTS rate_limits (
  talk_id TEXT PRIMARY KEY,
  last_response_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Verificare structură creată
SELECT
  table_name,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = t.table_name) as columns
FROM information_schema.tables t
WHERE table_schema = 'public' AND table_name IN ('messages', 'processed_messages', 'rate_limits');
```

Ar trebui să vezi în output:
```
table_name           | columns
---------------------|--------
messages             | 6
processed_messages   | 2
rate_limits          | 2
```

---

## Pas 3 — Activează Row Level Security (RLS) cu policy permisivă

Bot accesează DB cu service_role key care bypassează RLS, dar tot e bună practica să avem RLS activ.

În SQL Editor → New query → paste + Run:

```sql
-- Activează RLS
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- Policy: service_role poate face orice (bot folosește service_role)
-- Anon și authenticated NU au acces (mai sigur)
-- Nu mai e nevoie de policy explicită pentru service_role
```

---

## Pas 4 — Copiezi URL + API key

Supabase Dashboard → **Project Settings** (rotiță jos stânga) → **API**:

- **Project URL** → copiez în `SUPABASE_URL`
  ```
  https://abcdefghijklmnop.supabase.co
  ```
- **Project API keys** → **`service_role`** (NU `anon`!) → **Reveal** → copiez în `SUPABASE_KEY`
  ```
  eyJhbGciOiJIUzI1NiIs...
  ```

⚠️ **`service_role` are acces FULL la DB.** NICIODATĂ nu-l expune în client-side code, GitHub commit, sau log-uri publice.

---

## Pas 5 — Adaugi în Render Environment

1. Render Dashboard → service-ul `motiv-kommo-bot` → **Environment** tab
2. Adaugi 2 variabile noi:
   - `SUPABASE_URL` = `https://abcdefghijklmnop.supabase.co`
   - `SUPABASE_KEY` = `eyJhbGciOiJIUzI1NiIs...`
3. **Save Changes** → Render face redeploy automat (~2-3 min)

---

## Pas 6 — Verifică că funcționează

După redeploy:

1. Deschide Render Logs → ar trebui să vezi:
   ```
   ✅ Supabase storage activ
   💾 Storage: Supabase persistent
   ```
   Dacă vezi `⚠️ Supabase NOT configurat` — recheck env vars (probabil au typo).

2. Test live:
   ```
   GET https://motiv-kommo-bot.onrender.com/
   ```
   Răspuns ar trebui să arate `"storage": "Supabase"`.

3. După primul mesaj real prin webhook → în Supabase Dashboard → **Table Editor** → `messages` → vezi rândul nou.

---

## 🧹 Maintenance — cleanup periodic (opțional)

După 1-2 luni, ai 1.000-5.000 rânduri în `processed_messages` și `messages`.
Cleanup vechi (>30 zile) eliberează spațiu:

```sql
-- Rulează lunar în SQL Editor
DELETE FROM processed_messages WHERE created_at < NOW() - INTERVAL '7 days';
DELETE FROM messages WHERE created_at < NOW() - INTERVAL '90 days';
```

Sau setezi pg_cron job automat (avansate).

---

## 🐛 Debugging

**Eroare „relation does not exist"** → tabelele nu sunt create. Re-rulează SQL-ul din Pas 2.

**Eroare „invalid API key"** → ai folosit `anon` key în loc de `service_role`. Re-copiezi din Settings → API.

**Datele nu apar în Supabase deși bot rulează** → verifici log-uri Render pentru erori `axios POST supabase`. Adesea e URL malformat (lipsește `https://`).

**Bot răspunde de 2 ori la același mesaj** → dedup nu funcționează. Verifici că `processed_messages` table există + că INSERT-urile reușesc (vezi logs Render).
