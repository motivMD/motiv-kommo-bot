/**
 * MOTIV Kommo Bot v7.0
 * ────────────────────────────────────────────────────────────────────────
 * Schimbări față de v6:
 * ✅ Webhook răspunde 200 OK INSTANT (sub 100ms) — procesare async
 *    → Stop Render hibernation timeouts și KOMMO retry duplicate
 * ✅ Deduplicare composite (msg_id + talk_id + text_hash + minute_bucket)
 *    → 5 layere defensive, capture orice retry
 * ✅ Conversation history (ultimele 10 mesaje trimise la Claude)
 *    → Bot înțelege fluxul, nu doar mesajul curent
 * ✅ Rate limiting (1 răspuns / 60 sec / talk_id)
 *    → Iulia nu mai primește 8 răspunsuri la același mesaj
 * ✅ Storage Supabase (persistent) cu fallback in-memory
 *    → Datele supraviețuiesc Render hibernation
 * ✅ Knowledge base actualizat pentru REALIZATE post-sale flow
 *    → Aprobare machetă, livrare, plată, modificări design, timing
 * ✅ Filter mesaje obviously-menu (defensive, în caz că vin din istoric)
 * ✅ Structured logging + error tracking
 * ────────────────────────────────────────────────────────────────────────
 */

const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── CONFIG ──────────────────────────────────────────────────────────────
const CONFIG = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  KOMMO_API_KEY: process.env.KOMMO_API_KEY,
  KOMMO_SUBDOMAIN: process.env.KOMMO_SUBDOMAIN || "adminmotivmd",
  EXPORT_PASSWORD: process.env.EXPORT_PASSWORD || "motiv2026",
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_KEY: process.env.SUPABASE_KEY,
  CLAUDE_MODEL: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
  CLAUDE_MAX_TOKENS: parseInt(process.env.CLAUDE_MAX_TOKENS) || 500,
  PORT: process.env.PORT || 3000,
  RATE_LIMIT_SECONDS: parseInt(process.env.RATE_LIMIT_SECONDS) || 60,
  MAX_HISTORY_MESSAGES: parseInt(process.env.MAX_HISTORY_MESSAGES) || 10,
  DEDUP_TTL_HOURS: 24,
};

const ALLOWED_PIPELINE_ID = 7694754; // REALIZATE

// ─── STORAGE ─────────────────────────────────────────────────────────────
const useSupabase = !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_KEY);
let supabase = null;

if (useSupabase) {
  const { createClient } = require("@supabase/supabase-js");
  supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
  console.log("✅ Supabase storage activ");
} else {
  console.log("⚠️  Supabase NOT configurat — fallback la in-memory (date pierdute la restart)");
}

// In-memory fallback
const memDB = {
  conversations: new Map(),   // talk_id -> { messages: [...] }
  processed: new Map(),       // dedup_key -> timestamp
  rateLimits: new Map(),      // talk_id -> last_response_timestamp
};

// ─── DEDUPLICARE COMPOSITE ───────────────────────────────────────────────
function makeDedupKey(messageId, talkId, text) {
  // Layer 1: msg_id KOMMO (cea mai precisă)
  if (messageId) return `mid:${messageId}`;

  // Layer 2: hash text + talk_id + minute bucket (când msg_id lipsește)
  const minute = Math.floor(Date.now() / 60000); // bucket de 1 minut
  const textHash = crypto.createHash("sha256")
    .update(`${talkId || "no_talk"}|${text || ""}`)
    .digest("hex").substring(0, 16);
  return `hash:${textHash}:${minute}`;
}

async function isProcessed(dedupKey) {
  if (useSupabase) {
    const { data } = await supabase
      .from("processed_messages")
      .select("dedup_key")
      .eq("dedup_key", dedupKey)
      .single();
    return !!data;
  }
  // In-memory
  const ts = memDB.processed.get(dedupKey);
  if (!ts) return false;
  // TTL check (24h)
  const expired = (Date.now() - ts) > (CONFIG.DEDUP_TTL_HOURS * 3600 * 1000);
  if (expired) {
    memDB.processed.delete(dedupKey);
    return false;
  }
  return true;
}

async function markProcessed(dedupKey) {
  if (useSupabase) {
    await supabase.from("processed_messages").insert({
      dedup_key: dedupKey,
      created_at: new Date().toISOString(),
    });
    // Cleanup vechi (opțional, poate fi cron)
    const cutoff = new Date(Date.now() - CONFIG.DEDUP_TTL_HOURS * 3600 * 1000).toISOString();
    await supabase.from("processed_messages").delete().lt("created_at", cutoff);
    return;
  }
  memDB.processed.set(dedupKey, Date.now());
  // Limit dim memory (max 5000 entries)
  if (memDB.processed.size > 5000) {
    const oldest = Array.from(memDB.processed.entries())
      .sort((a, b) => a[1] - b[1])
      .slice(0, 1000)
      .map(([k]) => k);
    oldest.forEach(k => memDB.processed.delete(k));
  }
}

// ─── CONVERSATION HISTORY ────────────────────────────────────────────────
async function getConversationHistory(talkId, limit = CONFIG.MAX_HISTORY_MESSAGES) {
  if (useSupabase) {
    const { data } = await supabase
      .from("messages")
      .select("type, text, author, created_at")
      .eq("talk_id", talkId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data || []).reverse(); // chronological order
  }
  const conv = memDB.conversations.get(talkId);
  return (conv?.messages || []).slice(-limit);
}

async function saveMessage(talkId, leadId, type, text, author) {
  const message = { talk_id: talkId, lead_id: leadId, type, text, author, created_at: new Date().toISOString() };
  if (useSupabase) {
    await supabase.from("messages").insert(message);
    return;
  }
  if (!memDB.conversations.has(talkId)) {
    memDB.conversations.set(talkId, { talk_id: talkId, lead_id: leadId, messages: [] });
  }
  memDB.conversations.get(talkId).messages.push({ type, text, author, time: message.created_at });
}

// ─── RATE LIMITING ───────────────────────────────────────────────────────
async function canRespond(talkId) {
  const now = Date.now();
  if (useSupabase) {
    const { data } = await supabase
      .from("rate_limits")
      .select("last_response_at")
      .eq("talk_id", talkId)
      .single();
    if (!data) return true;
    const last = new Date(data.last_response_at).getTime();
    return (now - last) >= CONFIG.RATE_LIMIT_SECONDS * 1000;
  }
  const last = memDB.rateLimits.get(talkId);
  if (!last) return true;
  return (now - last) >= CONFIG.RATE_LIMIT_SECONDS * 1000;
}

async function markResponded(talkId) {
  const now = new Date().toISOString();
  if (useSupabase) {
    await supabase.from("rate_limits").upsert({
      talk_id: talkId,
      last_response_at: now,
    });
    return;
  }
  memDB.rateLimits.set(talkId, Date.now());
}

// ─── FILTER MESAJE-MENU (defensive) ──────────────────────────────────────
const SKIP_EXACT_PATTERNS = [
  "🇷🇴", "🇷🇺", "🇲🇩",
  "Tricou", "Hanorac", "Polo", "Pulover", "Șorț", "Chipiu",
  "Tricouri", "Hanorace", "Polouri",
  "Cuplu", "Pentru cuplu",
  "Tricoul", "Футболка", "Худи", "Кепка", "Поло",
  "Clasic", "Sport", "Modern",
  "OVERSIZE🔥", "OVERSIZE",
  "FLEXY 350 lei", "FLEXY 350 лей",
  "COMFY - 270 лей", "COMFY 270", "COMFY 270 lei",
  "CUPLU COMFY 499", "CUPLU COMFY 499 lei",
  "Înapoi", "Назад",
  "Înapoi la tricouri", "Înapoi la hanorace",
  "Обратно к футболкам", "Обратно к худи",
  "Classическая модель", "Классическая модель",
  "Continui", "Продолжить",
];

function isMenuMessage(text) {
  if (!text) return true;
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;

  // Exact match cu pattern-uri menu cunoscute
  if (SKIP_EXACT_PATTERNS.includes(trimmed)) return true;

  // Skip mesaje doar cu emoji (sub 5 caractere și începe cu emoji)
  if (trimmed.length <= 4 && /^[\u{1F000}-\u{1FFFF}\u{2000}-\u{2FFF}\u{1F1E6}-\u{1F1FF}]/u.test(trimmed)) return true;

  // Skip URL-uri standalone (transferuri fișiere etc.)
  if (/^https?:\/\/\S+$/.test(trimmed) && trimmed.length < 80) return true;

  return false;
}

// ─── PIPELINE CHECK ──────────────────────────────────────────────────────
async function isInAllowedPipeline(leadId, subdomain) {
  if (!leadId) return false;
  try {
    const res = await axios.get(
      `https://${subdomain}.kommo.com/api/v4/leads/${leadId}`,
      {
        headers: { Authorization: `Bearer ${CONFIG.KOMMO_API_KEY}` },
        timeout: 5000,
      }
    );
    const pipelineId = res.data?.pipeline_id;
    return pipelineId === ALLOWED_PIPELINE_ID;
  } catch (e) {
    console.error(`❌ Pipeline check eșuat #${leadId}:`, e.message);
    return false;
  }
}

// ─── KNOWLEDGE BASE (REALIZATE-specific) ─────────────────────────────────
const MOTIV_KNOWLEDGE = `Ești asistentul virtual al MOTIV — companie din Republica Moldova specializată în personalizare haine și accesorii.
Slogan: "Fii DIFERIT. Fii UNIC."
Site retail: motiv.md | Site corporate B2B: business.motiv.md

CONTEXT IMPORTANT — TU RĂSPUNZI DOAR PE PÂLNIA "REALIZATE":
Asta înseamnă că clientul:
- A făcut deja comandă SAU a primit deja machetă
- Este în etapa POST-VÂNZARE (aprobare, livrare, plată, follow-up)
- NU este lead nou care întreabă prețuri (acel scenariu e în alte pâlnii)

═══════════════════════════════════════════════════════════════
TIPURI DE MESAJE PE CARE LE PRIMEȘTI ȘI CUM RĂSPUNZI:
═══════════════════════════════════════════════════════════════

1. APROBARE MACHETĂ ("Aprob", "Îmi place, aprob", "Totul e ok, aprob", "Confirm"):
   Răspuns: "Mulțumesc pentru aprobare! Începem producția imediat. Comanda va fi gata în 3-5 zile lucrătoare 💜"

2. CERERE MODIFICARE DESIGN ("Logo-ul nu e centrat", "Mai spre stânga", "Trebuie mai mare"):
   Răspuns: Confirmă că ai înțeles + spune că trimiti machetei către designer pentru ajustare.
   Exemplu: "Am notat! Designerul nostru va face ajustarea și veți primi noua machetă în maximum 2-3 ore lucrătoare 🎨"
   NU încerca tu să ajustezi — escaladare la designer.

3. CERERE LIVRARE ("Vreau livrare"):
   Răspuns: "Perfect! Pentru livrare am nevoie de: numele complet, adresa exactă, orașul/raionul, și un număr de telefon pentru curier 🚚"

4. DATE LIVRARE PRIMITE (nume + adresă + telefon):
   Răspuns: "Mulțumesc! Datele sunt notate. Veți primi pachetul prin Fan Courier în 1-2 zile după ce comanda este gata. Vă anunț când AWB-ul este generat 📦"

5. ÎNTREBARE TIMING ("Când va fi gata?", "Cât durează?"):
   Răspuns: "Producția durează 3-5 zile lucrătoare de la aprobarea machetei. Vă voi anunța personal când comanda este gata pentru livrare sau ridicare ⏰"

6. METODE PLATĂ ("Cash", "Online", "MIA", "Transfer"):
   Răspuns scurt confirmare + ce trebuie să facă:
   - "Cash" → "Perfect, plata la ridicare/livrare. Notat ✅"
   - "Online" → "Vă trimit linkul pentru achitare online imediat 💳"
   - "MIA" sau "MI-A" → "Excelent, accept MIA. Vă trimit IBAN-ul și suma în următoarele minute 🏦"
   - "Transfer" → "Vă trimit datele bancare pe email"

7. PLATĂ ÎNTÂRZIATĂ ("Banii intră mâine", "Pot achita peste 2 zile"):
   Răspuns: "Nicio problemă! Vă păstrăm comanda în rezervă maximum 7 zile. Anunțați-mă când plata este gata și începem producția imediat 😊"

8. RIDICARE OFICIU ("Vin să le iau", "Pot ridica?"):
   Răspuns: "Sigur! Oficiul nostru: str. Ion Creangă 62/4, Chișinău. Program: Luni-Vineri 09:00-18:00, Sâmbătă 10:00-15:00. Sunt acolo când doriți să veniți? 📍"

9. MULȚUMIRI / SALUT FINAL ("Mulțumesc", "O zi frumoasă", "Mersi mult"):
   Răspuns scurt și cald: "Cu plăcere! O zi frumoasă și dumneavoastră 💜" sau echivalent.

10. CONFIRMARE PRIMIRE COMANDĂ ("Am primit comanda", "Получила заказ спасибо"):
    Răspuns: "Ne bucurăm că ați primit! Vă rugăm să ne lăsați și o recenzie pe Google sau Instagram dacă ați fost mulțumit 🌟 Mulțumim de încredere!"

11. ÎNTREBARE MĂRIME ("M pentru el S pentru ea", "Xl"):
    Răspuns: Confirmă mărimile primite + verifică dacă mai sunt detalii ("Notat! M la el, S la ea. Alte detalii: culori, mesaje pe tricou?")

12. ALEGERE CULOARE ("Alb", "Negru", "Bej"):
    Răspuns: "Notat culoarea! Mai aveți de specificat mărimea sau ne dați alte preferințe?"

13. CU CUTIE / FĂRĂ CUTIE:
    Răspuns: "Cu cutie cadou — perfect! Notat 🎁" sau "Fără cutie, notat. Mai aveți alte cerințe?"

14. ÎNTREBĂRI DESPRE STOCURI / DISPONIBILITATE ("Aveți polo?", "Aveți XL?"):
    Răspuns: Spune că verifici cu colegul și revii în câteva minute. NU inventa stocuri.
    Exemplu: "Verific stocul cu colega imediat și revin în 5-10 minute cu răspuns sigur 🔍"

15. PRINT PE HAINE ADUSE ("Pot să aduc tricoul meu?"):
    Răspuns: "Din păcate nu facem print pe haine aduse de client — riscul ca țesătura sau imprimeul să nu reziste e prea mare. Folosim doar tricouri din colecția noastră pentru garantarea calității. Vă pot recomanda un model similar din stocul nostru? 👕"

═══════════════════════════════════════════════════════════════
REGULI ABSOLUTE:
═══════════════════════════════════════════════════════════════

- LIMBA: Detectează automat limba clientului (RO sau RU). Răspunde în ACEEAȘI limbă.
  Dacă mesajul e prea scurt să detectezi → folosește română default.
- TON: Prietenos, tineresc, cu un emoji subtil (max 1-2 per mesaj).
- LUNGIME: Răspunsuri SCURTE (max 2-3 propoziții). Clienții pe WhatsApp vor rapid.
- NU INVENTA: Dacă nu știi (preț specific, stoc, statusul comenzii), spune că verifici cu colega și revii.
- NU PROMITE TERMENE STRICTE: Folosește "3-5 zile" sau "în aproximativ 2 ore" — nu "exact la 14:00".
- ESCALADARE LA OM: Pentru reclamații, modificări complexe, situații neclare → spune că un coleg revine personal în scurt timp.
- NICIODATĂ să nu spui "sunt un bot" sau "sunt AI" — comportă-te ca asistent uman politicos.
- NU REPETA acelaș mesaj de 2 ori — dacă vezi mesaj duplicat în istoric, IGNORĂ-l.

═══════════════════════════════════════════════════════════════
PROCES POST-COMANDĂ MOTIV (în această ordine):
═══════════════════════════════════════════════════════════════

1. Client primește mockup digital → APROBĂ sau CERE MODIFICĂRI
2. Modificări → designer ajustează → re-trimitem
3. Aprobare finală → PRODUCȚIE (3-5 zile lucrătoare)
4. Confirmare PLATĂ (cash la ridicare / online / MIA / transfer)
5. PRODUCERE comanda
6. LIVRARE (Fan Courier toata Moldova) sau RIDICARE oficiu
7. CONFIRMARE primire + cerere recenzie
`;

// ─── CLAUDE ──────────────────────────────────────────────────────────────
async function generateReply(currentMessage, history = []) {
  // Construiește array messages cu istoric
  const messages = [];

  // Adaugă istoric (alternat user/assistant)
  for (const msg of history) {
    if (msg.type === "incoming") {
      messages.push({ role: "user", content: msg.text });
    } else if (msg.type === "outgoing") {
      messages.push({ role: "assistant", content: msg.text });
    }
  }

  // Mesaj curent
  messages.push({ role: "user", content: currentMessage });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CONFIG.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: CONFIG.CLAUDE_MAX_TOKENS,
      system: MOTIV_KNOWLEDGE,
      messages: messages,
    }),
  });

  const data = await response.json();
  if (data.error) {
    console.error("❌ Claude error:", data.error);
    throw new Error(data.error.message);
  }
  return data.content[0].text;
}

// ─── KOMMO ───────────────────────────────────────────────────────────────
async function sendMessageToKommo(talkId, message, subdomain) {
  const url = `https://${subdomain}.kommo.com/api/v4/talks/${talkId}/messages`;
  await axios.post(url, { text: message, type: "outgoing" }, {
    headers: {
      Authorization: `Bearer ${CONFIG.KOMMO_API_KEY}`,
      "Content-Type": "application/json",
    },
    timeout: 10000,
  });
}

// ─── WEBHOOK HANDLER (ASYNC) ─────────────────────────────────────────────
async function processWebhook(body) {
  const messages = body?.message?.add || [];
  const subdomain = body?.account?.subdomain || CONFIG.KOMMO_SUBDOMAIN;

  for (const msg of messages) {
    try {
      if (msg.type !== "incoming") continue;

      const messageId = msg.id;
      const text = msg.text;
      const talkId = msg.talk_id;
      const leadId = msg.element_id;
      const author = msg.author?.name || "client";

      if (!text || !talkId) {
        console.log(`⏭️  Skip (lipsă text sau talkId)`);
        continue;
      }

      // 1. Filter mesaje meniu
      if (isMenuMessage(text)) {
        console.log(`⏭️  Skip menu/empty: "${text.substring(0, 40)}"`);
        continue;
      }

      // 2. Deduplicare composite
      const dedupKey = makeDedupKey(messageId, talkId, text);
      if (await isProcessed(dedupKey)) {
        console.log(`⏭️  Skip dup: ${dedupKey}`);
        continue;
      }

      // 3. Pipeline check
      if (leadId) {
        const allowed = await isInAllowedPipeline(leadId, subdomain);
        if (!allowed) {
          console.log(`🚫 Lead #${leadId} nu e în REALIZATE`);
          continue;
        }
      }

      // 4. Rate limit
      if (!(await canRespond(talkId))) {
        console.log(`⏱️  Rate limit talk #${talkId} (sub ${CONFIG.RATE_LIMIT_SECONDS}s de la ultim răspuns)`);
        continue;
      }

      // Mark processed (după toate filtrele, înainte de Claude)
      await markProcessed(dedupKey);

      // Salvăm mesajul incoming
      await saveMessage(talkId, leadId, "incoming", text, author);

      console.log(`💬 lead #${leadId} talk #${talkId}: ${text.substring(0, 100)}`);

      // 5. Load history pentru context
      const history = await getConversationHistory(talkId, CONFIG.MAX_HISTORY_MESSAGES);
      // Exclude mesajul curent din history (ultimul, just saved)
      const historyForClaude = history.slice(0, -1);

      // 6. Generate reply
      const reply = await generateReply(text, historyForClaude);
      console.log(`🤖 reply: ${reply.substring(0, 100)}`);

      // 7. Send to KOMMO
      await sendMessageToKommo(talkId, reply, subdomain);

      // 8. Save outgoing + mark rate limit
      await saveMessage(talkId, leadId, "outgoing", reply, "MOTIV Bot");
      await markResponded(talkId);

      console.log(`✅ Trimis talk #${talkId}`);
    } catch (err) {
      console.error(`❌ Eroare procesare mesaj:`, err.message);
    }
  }
}

// ─── ENDPOINTS ───────────────────────────────────────────────────────────

// CRITICAL: webhook răspunde 200 OK INSTANT (sub 100ms)
// Procesarea se face async în background → KOMMO nu mai retry pe timeout
app.post("/webhook", (req, res) => {
  res.json({ status: "ok" });
  // Process in background — nu așteptăm
  setImmediate(() => {
    processWebhook(req.body).catch(err => {
      console.error("❌ Background processing error:", err.message);
    });
  });
});

// Export endpoint (păstrat din v6, îmbunătățit)
app.get("/export", async (req, res) => {
  if (req.query.password !== CONFIG.EXPORT_PASSWORD) {
    return res.status(401).json({ error: "Parolă greșită" });
  }

  let conversations = [];
  if (useSupabase) {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(5000);
    const grouped = {};
    for (const m of (data || [])) {
      if (!grouped[m.talk_id]) grouped[m.talk_id] = { talk_id: m.talk_id, lead_id: m.lead_id, messages: [] };
      grouped[m.talk_id].messages.push({ type: m.type, text: m.text, author: m.author, time: m.created_at });
    }
    conversations = Object.values(grouped);
  } else {
    conversations = Array.from(memDB.conversations.values());
  }

  const totalMessages = conversations.reduce((s, c) => s + c.messages.length, 0);
  const incoming = conversations.flatMap(c => c.messages.filter(m => m.type === "incoming"));
  const outgoing = conversations.flatMap(c => c.messages.filter(m => m.type === "outgoing"));

  // Top cuvinte din incoming
  const words = incoming.map(m => m.text).join(" ").toLowerCase()
    .replace(/[^\wăâîșțА-Яа-я\s]/g, " ")
    .split(/\s+/).filter(w => w.length > 3);
  const freq = {};
  words.forEach(w => freq[w] = (freq[w] || 0) + 1);
  const topWords = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 30);

  res.json({
    stats: {
      total_conversations: conversations.length,
      total_messages: totalMessages,
      incoming_messages: incoming.length,
      outgoing_messages: outgoing.length,
      reply_rate: incoming.length > 0 ? ((outgoing.length / incoming.length) * 100).toFixed(1) + "%" : "N/A",
    },
    top_words: topWords,
    storage: useSupabase ? "Supabase" : "in-memory",
    version: "7.0.0",
    conversations,
  });
});

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "🟢 MOTIV Bot v7 activ",
    version: "7.0.0",
    allowed_pipeline: ALLOWED_PIPELINE_ID,
    storage: useSupabase ? "Supabase" : "in-memory (⚠️ datele se pierd la restart)",
    model: CONFIG.CLAUDE_MODEL,
    config: {
      rate_limit_sec: CONFIG.RATE_LIMIT_SECONDS,
      max_history: CONFIG.MAX_HISTORY_MESSAGES,
      dedup_ttl_h: CONFIG.DEDUP_TTL_HOURS,
    },
    timestamp: new Date().toISOString(),
  });
});

// Admin: clear stuck state (dev only)
app.post("/admin/clear-rate-limit", async (req, res) => {
  if (req.query.password !== CONFIG.EXPORT_PASSWORD) {
    return res.status(401).json({ error: "Parolă greșită" });
  }
  const talkId = req.query.talk_id;
  if (!talkId) return res.status(400).json({ error: "lipsă talk_id" });

  if (useSupabase) {
    await supabase.from("rate_limits").delete().eq("talk_id", talkId);
  } else {
    memDB.rateLimits.delete(talkId);
  }
  res.json({ ok: true, cleared: talkId });
});

// ─── START ───────────────────────────────────────────────────────────────
app.listen(CONFIG.PORT, () => {
  console.log(`🚀 MOTIV Kommo Bot v7.0 pornit pe portul ${CONFIG.PORT}`);
  console.log(`🎯 Răspunde DOAR în pipeline: ${ALLOWED_PIPELINE_ID} (REALIZATE)`);
  console.log(`💾 Storage: ${useSupabase ? "Supabase persistent" : "in-memory (volatil)"}`);
  console.log(`🤖 Model: ${CONFIG.CLAUDE_MODEL}`);
  console.log(`⏱️  Rate limit: 1 răspuns / ${CONFIG.RATE_LIMIT_SECONDS}s / talk_id`);
  console.log(`📚 History: ultimele ${CONFIG.MAX_HISTORY_MESSAGES} mesaje`);
});
