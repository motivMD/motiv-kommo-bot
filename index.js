const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ─── CONFIG ────────────────────────────────────────────────────────────────
const CONFIG = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  KOMMO_API_KEY: process.env.KOMMO_API_KEY,
  KOMMO_SUBDOMAIN: process.env.KOMMO_SUBDOMAIN, // ex: "motiv" din motiv.kommo.com
  PORT: process.env.PORT || 3000,
};

// ─── BAZA DE CUNOȘTINȚE MOTIV ───────────────────────────────────────────────
const MOTIV_KNOWLEDGE = `
Ești asistentul virtual al MOTIV — companie din Moldova specializată în personalizarea hainelor și accesoriilor.
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

REGULI DE COMPORTAMENT:
- Detectează automat limba clientului (română sau rusă) și răspunde în ACEEAȘI limbă
- Fii prietenos, tineresc, cu umor ușor — ca un prieten care recomandă ceva cool
- Folosește emoji moderat (1-2 per mesaj)
- Dacă nu știi răspunsul exact, spune că un coleg va reveni în scurt timp
- Nu inventa prețuri sau informații pe care nu le ai
- Dacă clientul vrea comandă corporate (10+ bucăți), direcționează spre business.motiv.md
- Dacă clientul vrea comandă retail, direcționează spre motiv.md
- Răspunsurile să fie scurte și clare (max 3-4 propoziții)
`;

// ─── DETECTEAZĂ DACĂ MESAJUL NECESITĂ RĂSPUNS ──────────────────────────────
function shouldRespond(message) {
  if (!message || message.trim().length === 0) return false;
  // Nu răspunde la mesaje de sistem sau notificări
  const systemPhrases = ["a creat lead", "a schimbat", "a adăugat", "изменил", "создал"];
  return !systemPhrases.some((phrase) => message.toLowerCase().includes(phrase));
}

// ─── GENEREAZĂ RĂSPUNS CU CLAUDE ───────────────────────────────────────────
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

  if (data.error) {
    console.error("Claude API error:", data.error);
    throw new Error(data.error.message);
  }

  return data.content[0].text;
}

// ─── TRIMITE MESAJ ÎNAPOI ÎN KOMMO ─────────────────────────────────────────
async function sendMessageToKommo(leadId, message) {
  const url = `https://${CONFIG.KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}/notes`;

  const payload = {
    add: [
      {
        note_type: "common",
        params: {
          text: message,
        },
      },
    ],
  };

  await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${CONFIG.KOMMO_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
}

// ─── WEBHOOK ENDPOINT ───────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;
    console.log("📩 Webhook primit:", JSON.stringify(body, null, 2));

    // Kommo trimite events de tip "message" sau "lead"
    const events = body?.leads?.update || body?.leads?.add || [];
    const messages = body?.message || [];

    // Procesăm mesajele noi
    const incomingMessages = Array.isArray(messages) ? messages : [messages];

    for (const msg of incomingMessages) {
      const text = msg?.text || msg?.params?.text;
      const leadId = msg?.lead?.id || msg?.entity_id;

      if (!text || !leadId) continue;
      if (!shouldRespond(text)) continue;

      console.log(`💬 Mesaj de la client (lead #${leadId}): ${text}`);

      // Generăm răspuns cu Claude
      const reply = await generateReply(text);
      console.log(`🤖 Răspuns Claude: ${reply}`);

      // Trimitem răspunsul în Kommo
      await sendMessageToKommo(leadId, reply);
      console.log(`✅ Răspuns trimis în Kommo pentru lead #${leadId}`);
    }

    res.json({ status: "ok" });
  } catch (error) {
    console.error("❌ Eroare webhook:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── HEALTH CHECK ───────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status: "🟢 MOTIV Bot activ",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

// ─── START SERVER ───────────────────────────────────────────────────────────
app.listen(CONFIG.PORT, () => {
  console.log(`🚀 MOTIV Kommo Bot pornit pe portul ${CONFIG.PORT}`);
  console.log(`📡 Webhook URL: http://localhost:${CONFIG.PORT}/webhook`);
});
