const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Kommo trimite form-urlencoded

// в”Ђв”Ђв”Ђ CONFIG в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
const CONFIG = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  KOMMO_API_KEY: process.env.KOMMO_API_KEY,
  KOMMO_SUBDOMAIN: process.env.KOMMO_SUBDOMAIN,
  PORT: process.env.PORT || 3000,
};

// в”Ђв”Ђв”Ђ BAZA DE CUNOИTINИљE MOTIV в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
const MOTIV_KNOWLEDGE = `
E™ti asistentul virtual al MOTIV вЂ” companie din Moldova specializatДѓ Г®n personalizarea hainelor И™i accesoriilor.
Site retail: motiv.md | Site corporate: business.motiv.md
Slogan: "Fii DIFERIT. Fii UNIC."

PRODUSE ИI PREИљURI:
- Tricouri personalizate: 250-340 MDL
- Hanorace personalizate: 450-690 MDL
- Pulovere, polo, accesorii (cДѓciuli, И™epci, rucsacuri, torbe, И™orИ›uri, sticle)
- Constructor online pe site pentru design personalizat

COMENZI ИI LIVRARE:
- Livrare Г®n toatДѓ Moldova
- Comenzi retail (cantitate micДѓ): motiv.md
- Comenzi corporate/en-gros (minim 10 buc): business.motiv.md
- OfertДѓ: 50 MDL reducere la prima comandДѓ

PERSONALIZARE:
- Design-uri unice prin constructorul online
- Posibilitate upload logo propriu
- Print, broderie, transfer termic

RETUR:
- Retur acceptat Г®n 14 zile de la primire
- Produsele personalizate nu se returneazДѓ (excepИ›ie: defect de producИ›ie)

REGULI DE COMPORTAMENT:
- DetecteazДѓ automat limba clientului (romГўnДѓ sau rusДѓ) И™i rДѓspunde Г®n ACEEAИI limbДѓ
- Fii prietenos, tineresc, cu umor uИ™or вЂ” ca un prieten care recomandДѓ ceva cool
- FoloseИ™te emoji moderat (1-2 per mesaj)
- DacДѓ nu И™tii rДѓspunsul exact, spune cДѓ un coleg va reveni Г®n scurt timp
- Nu inventa preИ›uri sau informaИ›ii pe care nu le ai
- DacДѓ clientul vrea comandДѓ corporate (10+ bucДѓИ›i), direcИ›ioneazДѓ spre business.motiv.md
- DacДѓ clientul vrea comandДѓ retail, direcИ›ioneazДѓ spre motiv.md
- RДѓspunsurile sДѓ fie scurte И™i clare (max 3-4 propoziИ›ii)
`;

// в”Ђв”Ђв”Ђ GENEREAZД‚ RД‚SPUNS CU CLAUDE в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
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

// в”Ђв”Ђв”Ђ TRIMITE MESAJ ГЋNAPOI ГЋN KOMMO в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
async function sendMessageToKommo(leadId, message) {
  const url = `https://${CONFIG.KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}/notes`;
  await axios.post(url, {
    add: [{ note_type: "common", params: { text: message } }],
  }, {
    headers: {
      Authorization: `Bearer ${CONFIG.KOMMO_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
}

// в”Ђв”Ђв”Ђ EXTRAGE MESAJ DIN ORICE FORMAT KOMMO в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
function extractFromPayload(body) {
  console.log("рџ”Ќ Body complet:", JSON.stringify(body, null, 2));

  // Format 1: message[0][text] + message[0][element_id] (form-urlencoded)
  if (body.message) {
    const msgs = Array.isArray(body.message) ? body.message : [body.message];
    for (const m of msgs) {
      const text = m.text || m.params?.text;
      const leadId = m.lead?.id || m.entity_id || m.element_id;
      if (text && leadId) return { text, leadId };
    }
  }

  // Format 2: leads[update][0][id] sau leads[add][0][id]
  const leads = body.leads?.update || body.leads?.add || [];
  for (const lead of leads) {
    if (lead.id) return { leadId: lead.id, text: null };
  }

  // Format 3: chei plate (Kommo uneori trimite flat)
  const keys = Object.keys(body);
  console.log("рџ”‘ Chei gДѓsite:", keys);

  return null;
}

// в”Ђв”Ђв”Ђ WEBHOOK ENDPOINT в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
app.post("/webhook", async (req, res) => {
  try {
    console.log("рџ“© Content-Type:", req.headers["content-type"]);
    console.log("рџ“© Body raw:", JSON.stringify(req.body));

    const extracted = extractFromPayload(req.body);

    if (!extracted) {
      console.log("вљ пёЏ Nu s-au gДѓsit date utilizabile Г®n payload");
      return res.json({ status: "ok", note: "no actionable data" });
    }

    const { text, leadId } = extracted;

    if (!text) {
      console.log("вљ пёЏ Mesaj fДѓrДѓ text, ignorat");
      return res.json({ status: "ok", note: "no text" });
    }

    console.log(`рџ’¬ Mesaj (lead #${leadId}): ${text}`);

    const reply = await generateReply(text);
    console.log(`рџ¤– RДѓspuns Claude: ${reply}`);

    await sendMessageToKommo(leadId, reply);
    console.log(`вњ… RДѓspuns trimis pentru lead #${leadId}`);

    res.json({ status: "ok" });
  } catch (error) {
    console.error("вќЊ Eroare:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// в”Ђв”Ђв”Ђ HEALTH CHECK в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
app.get("/", (req, res) => {
  res.json({ status: "рџџў MOTIV Bot activ", version: "2.0.0", timestamp: new Date().toISOString() });
});

app.listen(CONFIG.PORT, () => {
  console.log(`рџљЂ MOTIV Kommo Bot v2.0 pornit pe portul ${CONFIG.PORT}`);
});
