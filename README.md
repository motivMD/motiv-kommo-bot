# 🤖 MOTIV Kommo Bot v7

Bot automat care răspunde clienților **în pâlnia REALIZATE** prin Kommo CRM, folosind Claude AI.

---

## ⚡ TL;DR — diferențe față de v6

| Problemă v6 | Fix v7 |
|-------------|--------|
| 🚨 Webhook retry → mesaj duplicat de 5-8× | ✅ Răspuns 200 OK INSTANT (sub 100ms), procesare async |
| 🚨 Dedup eșua când msg_id se schimba | ✅ Dedup composite (msg_id + hash text + minute bucket) |
| 🚨 Bot uita contextul conversației | ✅ Trimite ultimele 10 mesaje la Claude |
| 🚨 Date pierdute la Render hibernation | ✅ Supabase persistent (cu fallback in-memory) |
| 🚨 Bot răspundea la mesaje meniu | ✅ Filter defensiv pe pattern-uri menu cunoscute |
| 🚨 Bot răspundea de N ori la mesaj rapid | ✅ Rate limit 1 răspuns / 60 sec / talk_id |
| 🚨 Knowledge generic pentru toate scenariile | ✅ Knowledge **specific REALIZATE** (post-sale) |

---

## 📐 Cum funcționează

```
Client WhatsApp → Kommo → Webhook (v7) → 200 OK instant
                                            ↓ (async, în background)
                                          Filter menu
                                            ↓
                                          Dedup composite
                                            ↓
                                          Pipeline = REALIZATE?
                                            ↓
                                          Rate limit OK?
                                            ↓
                                          Load history (10 msg)
                                            ↓
                                          Claude API
                                            ↓
                                          Trimite la Kommo → Client
                                            ↓
                                          Salvează în Supabase
```

---

## 🚀 Deploy în 6 pași

### Pas 1 — Clonează/descarcă codul

Descarcă tot folderul `motiv-kommo-bot-v7` în calculator sau push pe GitHub.

### Pas 2 — Setup Supabase (10 min)

Vezi **[SUPABASE_SETUP.md](SUPABASE_SETUP.md)** — instrucțiuni detaliate cu SQL.
Te alegi cu `SUPABASE_URL` + `SUPABASE_KEY` la final.

⚠️ Poți skipa Supabase și folosi in-memory pentru testare, dar **datele se pierd la fiecare restart Render** (aprox. la fiecare 15 min idle pe free tier).

### Pas 3 — Copiezi `.env.example` în `.env`

```bash
cp .env.example .env
```

Completează minim:
- `ANTHROPIC_API_KEY` (de pe console.anthropic.com)
- `KOMMO_API_KEY` (Long-term token din Kommo)
- `KOMMO_SUBDOMAIN` (ex: `adminmotivmd`)
- `SUPABASE_URL` + `SUPABASE_KEY` (recomandat)

### Pas 4 — Push pe GitHub

```bash
git init
git add .
git commit -m "Bot v7 — dedup composite + history + Supabase"
git remote add origin https://github.com/tu/motiv-kommo-bot.git
git push -u origin main
```

⚠️ Verifică că `.env` e în `.gitignore` (vezi pas Securitate de jos).

### Pas 5 — Deploy pe Render.com

1. https://render.com → **New** → **Web Service** → conectează GitHub repo
2. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `node index.js`
   - **Plan:** Free (sau Starter $7/lună dacă vrei zero hibernation)
3. **Environment** → adaugi toate variabilele din `.env` (NU upload-uezi fișierul `.env`!)
4. **Create Web Service** → așteapți deploy (~3 min)
5. Copiezi URL-ul generat: `https://motiv-kommo-bot.onrender.com`

### Pas 6 — Configurează webhook în Kommo

Dacă webhook-ul v6 era deja configurat, n-ai nevoie să schimbi nimic (URL-ul rămâne același).

Altfel:
1. Kommo → **Settings** → **Integrations** → **Webhooks**
2. Webhook nou:
   - **URL:** `https://motiv-kommo-bot.onrender.com/webhook`
   - **Events:** bifează `Incoming message`
3. Save

---

## 🧪 Testare după deploy

### Test 1 — Health check
```
GET https://motiv-kommo-bot.onrender.com/
```

Răspuns așteptat:
```json
{
  "status": "🟢 MOTIV Bot v7 activ",
  "version": "7.0.0",
  "allowed_pipeline": 7694754,
  "storage": "Supabase persistent",
  "model": "claude-sonnet-4-20250514",
  "config": {
    "rate_limit_sec": 60,
    "max_history": 10,
    "dedup_ttl_h": 24
  }
}
```

### Test 2 — Trimite un mesaj real

În KOMMO chat, trimite mesaj de la un lead aflat în pâlnia REALIZATE:
> „Bună, când va fi gata comanda?"

Așteptări (vezi Render Logs):
```
💬 lead #76801895 talk #34567: Bună, când va fi gata comanda?
🤖 reply: Bună ziua! Producția durează 3-5 zile lucrătoare după aprobarea machetei...
✅ Trimis talk #34567
```

### Test 3 — Verifică dedup

Trimite ACELAȘI mesaj din nou imediat. Așteptări:
```
⏭️  Skip dup: mid:1234567890
```

### Test 4 — Verifică rate limit

Trimite alt mesaj la mai puțin de 60 sec. Așteptări:
```
⏱️  Rate limit talk #34567 (sub 60s de la ultim răspuns)
```

### Test 5 — Verifică /export

```
GET https://motiv-kommo-bot.onrender.com/export?password=motiv2026
```

Răspuns trebuie să includă:
- `stats.outgoing_messages > 0` (înainte era 0!)
- `stats.reply_rate` (procent răspuns)
- Conversațiile cu mesaje both `incoming` și `outgoing`

---

## 🐛 Debugging frecvent

### „Bot nu răspunde deloc"

1. Verifică `/` returnează status verde
2. Verifică logs Render — căutare ce face când vine webhook
3. Cele mai frecvente cauze:
   - `ANTHROPIC_API_KEY` invalid sau expired → Claude error 401
   - `KOMMO_API_KEY` invalid → POST la KOMMO eșuează cu 401
   - Pipeline check returnează `false` pentru toate lead-urile → verifici `ALLOWED_PIPELINE_ID = 7694754` în cod

### „Bot răspunde de 2 ori la același mesaj"

Cu dedup composite v7, asta nu mai ar trebui să se întâmple. Dacă apare:
1. Verifică Supabase → table `processed_messages` — INSERT-urile funcționează?
2. Dacă folosești in-memory (no Supabase), Render hibernation resetează state. **Soluție: setup Supabase**.

### „Bot răspunde target la mesaje meniu"

Adaugă pattern-ul nou în `SKIP_EXACT_PATTERNS` din `index.js`, redeploy.

### „Claude răspunde generic, nu folosește contextul"

Verifică în Render logs că `history.length > 0` la momentul Claude call.
Dacă e mereu 0 → Supabase select nu returnează date. Verifică table `messages` direct.

---

## 🔐 Securitate

### Checklist obligatoriu:

- [ ] `.env` în `.gitignore` (verifică: `git check-ignore .env` returnează cale)
- [ ] `KOMMO_API_KEY` și `ANTHROPIC_API_KEY` NU sunt commit-uite niciodată
- [ ] `EXPORT_PASSWORD` NU e default `motiv2026` în producție (schimbă cu ceva random)
- [ ] Supabase `service_role` key e DOAR în Render env vars (nu în code)
- [ ] Audit git history: `git log -p | grep -i "sk-ant\|kommo_api"` — dacă apar tokeni, **revoke-i imediat** și generează noi

### `.gitignore` minim:
```
node_modules/
.env
.env.local
.DS_Store
*.log
```

---

## 📊 Monitoring & analytics

Endpoint `/export?password=...` returnează:
- Total conversații + mesaje
- Reply rate (% mesaje incoming → outgoing)
- Top 30 cuvinte
- Conversații complete (cu istoric)

Folosește pentru:
- Identificare întrebări frecvente → adaugi în knowledge base
- Calculare conversion rate bot → vânzare
- Tuning rate limit / max history

Pentru analytics avansate, poți query direct Supabase cu SQL.

---

## 💰 Costuri estimate

| Item | Cost lunar |
|------|------------|
| Render Free | $0 (cu hibernation 15 min) |
| Render Starter | $7 (zero hibernation, recomandat producție) |
| Supabase Free | $0 (500MB) |
| Claude API Sonnet 4 | ~$5-20 (depinde volum mesaje) |
| **Total tipic** | **$5-27 / lună** |

La 14 conversații/zi × 30 zile = 420 conversații/lună × ~5 mesaje/conv × ~800 token/mesaj ≈ **1.68M tokens input / 168K tokens output / lună**.

Sonnet 4 prețuri: $3/M input + $15/M output = **~$7.5/lună Claude pentru volumul actual**.

---

## 📝 Changelog

### v7.0 (29 mai 2026)
- Async webhook handling (200 OK <100ms)
- Dedup composite cu 2 layere
- Conversation history în Claude
- Rate limiting per talk_id
- Supabase persistent storage cu fallback
- Knowledge base REALIZATE-specific
- Filter mesaje meniu (defensive)
- Endpoint `/admin/clear-rate-limit` (dev tool)

### v6.0 — versiunea anterioară
- Pipeline filter REALIZATE
- Deduplicare simplă pe message_id
- In-memory storage `/tmp/`
- Knowledge base general (RO+RU)

---

## 📞 Suport

Probleme deploy → întrebări la dezvoltator.
Probleme knowledge → editezi direct `MOTIV_KNOWLEDGE` în `index.js`.
