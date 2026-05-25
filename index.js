const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const CONFIG = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  KOMMO_API_KEY: process.env.KOMMO_API_KEY,
  KOMMO_SUBDOMAIN: process.env.KOMMO_SUBDOMAIN,
  EXPORT_PASSWORD: process.env.EXPORT_PASSWORD || "motiv2026",
  PORT: process.env.PORT || 3000,
};

const DB_FILE = "/tmp/conversations.json";

// ─── DB SIMPLU ──────────────────────────────────────────────────────────────
function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch(e) {}
  return { conversations: {} };
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db));
}

function saveMessage(talkId, leadId, type, text, author) {
  const db = loadDB();
  if (!db.conversations[talkId]) {
    db.conversations[talkId] = { talk_id: talkId, lead_id: leadId, messages: [] };
  }
  db.conversations[talkId].messages.push({
    type, text, author,
    time: new Date().toISOString(),
  });
  saveDB(db);
}

// ─── BAZA DE CUNOȘTINȚE MOTIV ───────────────────────────────────────────────
const MOTIV_KNOWLEDGE = `
E ti asistentul virtual al MOTIV — companie din Moldova specializată în personalizarea hainelor și accesoriilor.
Site retail: motiv.md | Site corporate: business.motiv.md
Slogan: "Fii DIFERIT. Fii UNIC."

PRODUSE ȘI PREȚURI:
- Tricouri personalizate: 250-340 MDL
- Hanorace personalizate: 450-690 MDL
- Pulovere, polo, accesorii (căciuli, șepci, rucsacuri, torbe, șorțuri, sticle)
- Constructor online pe site pentru design personalizat

COMENZI ȘI LIVRARE:
- Livrare în toată Moldova
- Comenzi retail (cantitate mică): motiv.md
- Comenzi corporate/en-gros (minim 10 buc): business.motiv.md
- Ofertă: 50 MDL reducere la prima comandă

PERSONALIZARE:
- Design-uri unice prin constructorul online
- Posibilitate upload logo propriu
- Print, broderie, transfer termic

RETUR:
- Retur acceptat în 14 zile de la primire
- Produsele personalizate nu se returnează (excepție: defect de producție)

REGULI:
- Detectează automat limba clientului (română sau rusă) și răspunde în ACEEAȘI limbă
- Fii prietenos, tineresc, cu umor ușor
- Folosește emoji moderat (1-2 per mesaj)
- Dacă nu știi răspunsul exact, spune că un coleg va reveni în scurt timp
- Dacă clientul vrea comandă corporate (10+ bucăți), direcționează spre business.motiv.md
- Dacă clientul vrea comandă retail, direcționează spre motiv.md
- Răspunsurile să fie scurte și clare (max 3-4 propoziții)
- Răspunde DOAR la mesaje de tip incoming
`;

// ─── CLAUDE ─────────────────────────────────────────────────────────────────
async function generateReply(customerMessage) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CONFIG.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: MOTIV_KNOWLEDGE,
      messages: [{ role: "user", content: customerMessage }],
    }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.content[0].text;
}

// ─── KOMMO ──────────────────────────────────────────────────────────────────
async function sendMessageToKommo(talkId, message, subdomain) {
  const url = `https://${subdomain}.kommo.com/api/v4/talks/${talkId}/messages`;
  await axios.post(url, { text: message, type: "outgoing" }, {
    headers: {
      Authorization: `Bearer ${CONFIG.KOMMO_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
}

// ─── WEBHOOK ─────────────────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;
    const messages = body?.message?.add || [];

    for (const msg of messages) {
      if (msg.type !== "incoming") continue;

      const text = msg.text;
      const talkId = msg.talk_id;
      const leadId = msg.element_id;
      const author = msg.author?.name || "client";

      if (!text || !talkId) continue;

      console.log(`💬 (lead #${leadId}): ${text}`);

      // Salvăm mesajul clientului
      saveMessage(talkId, leadId, "incoming", text, author);

      // Generăm răspuns
      const reply = await generateReply(text);
      console.log(`🤖 Răspuns: ${reply}`);

      // Salvăm răspunsul botului
      saveMessage(talkId, leadId, "outgoing", reply, "MOTIV Bot");

      // Trimitem în Kommo
      const subdomain = body?.account?.subdomain || CONFIG.KOMMO_SUBDOMAIN;
      await sendMessageToKommo(talkId, reply, subdomain);
      console.log(`✅ Trimis pentru talk #${talkId}`);
    }

    res.json({ status: "ok" });
  } catch (error) {
    console.error("❌ Eroare:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── EXPORT CONVERSAȚII ──────────────────────────────────────────────────────
app.get("/export", (req, res) => {
  const pwd = req.query.password;
  if (pwd !== CONFIG.EXPORT_PASSWORD) {
    return res.status(401).json({ error: "Parolă greșită" });
  }

  const db = loadDB();
  const conversations = Object.values(db.conversations);
  const totalMessages = conversations.reduce((s, c) => s + c.messages.length, 0);
  const incoming = conversations.flatMap(c => c.messages.filter(m => m.type === "incoming"));

  // Top cuvinte
  const words = incoming.map(m => m.text).join(" ").toLowerCase()
    .replace(/[^\wăâîșțА-Яа-я\s]/g, " ")
    .split(/\s+/).filter(w => w.length > 3);
  const freq = {};
  words.forEach(w => freq[w] = (freq[w] || 0) + 1);
  const topWords = Object.entries(freq).sort((a,b) => b[1]-a[1]).slice(0, 30);

  res.json({
    stats: {
      total_conversations: conversations.length,
      total_messages: totalMessages,
      incoming_messages: incoming.length,
    },
    top_words: topWords,
    conversations,
  });
});

// ─── HEALTH ──────────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  const db = loadDB();
  const count = Object.keys(db.conversations).length;
  res.json({
    status: "🟢 MOTIV Bot activ",
    version: "4.0.0",
    conversations_saved: count,
    export_url: "/export?password=motiv2026",
    timestamp: new Date().toISOString(),
  });
});

app.listen(CONFIG.PORT, () => {
  console.log(`🚀 MOTIV Kommo Bot v4.0 pornit pe portul ${CONFIG.PORT}`);
});
