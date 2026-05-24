# 🤖 MOTIV Kommo Bot

Bot automat care răspunde clienților WhatsApp prin Kommo CRM, folosind Claude AI.

---

## Cum funcționează

```
Client WhatsApp → Kommo → Webhook → Serverul tău → Claude AI → Răspuns → Kommo → Client
```

---

## Setup în 4 pași

### Pas 1 — Clonează și instalează

```bash
git clone <repo>
cd motiv-kommo-bot
npm install
```

### Pas 2 — Configurează variabilele de mediu

Copiază `.env.example` în `.env` și completează:

```bash
cp .env.example .env
```

Deschide `.env` și adaugă:
- `ANTHROPIC_API_KEY` → de pe [platform.claude.com](https://platform.claude.com/api-keys)
- `KOMMO_API_KEY` → din Kommo → Settings → Integrations → Long-term token
- `KOMMO_SUBDOMAIN` → subdomeniu-ul tău (ex: `motiv` din `motiv.kommo.com`)

### Pas 3 — Deploy pe Render.com (gratuit)

1. Creează cont pe [render.com](https://render.com)
2. **New** → **Web Service** → conectează GitHub repo
3. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `node index.js`
4. Adaugă variabilele din `.env` în secțiunea **Environment**
5. Deploy → copiezi URL-ul generat (ex: `https://motiv-bot.onrender.com`)

### Pas 4 — Configurează Webhook în Kommo

1. Mergi în Kommo → **Settings** → **Integrations** → **Webhooks**
2. Adaugă webhook nou:
   - **URL:** `https://motiv-bot.onrender.com/webhook`
   - **Events:** bifează `Incoming message`
3. Salvează

---

## Testare locală

```bash
# Instalează ngrok pentru tunel local
npx ngrok http 3000

# Pornește serverul
npm run dev

# Setează URL-ul ngrok ca webhook temporar în Kommo
```

---

## Personalizare

Poți modifica baza de cunoștințe în `index.js`, secțiunea `MOTIV_KNOWLEDGE`.
Adaugă întrebări frecvente noi, prețuri actualizate, promoții sezoniere etc.

---

## Suport

Probleme? Verifică logurile în Render Dashboard → Logs.
