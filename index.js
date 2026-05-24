const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
- RДѓspunde DOAR la mesaje de tip "incoming" (de la client), nu la cele outgoing
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

// в”Ђв”Ђв”Ђ TRIMITE MESAJ ГЋNAPOI ГЋN KOMMO (ca outgoing message Г®n chat) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
async function sendMessageToKommo(talkId, message, subdomain) {
  // Folosim endpoint-ul de talk messages pentru a rДѓspunde direct Г®n chat
  const url = `https://${subdomain}.kommo.com/api/v4/talks/${talkId}/messages`;
  
  await axios.post(url, {
    text: message,
    type: "outgoing",
  }, {
    headers: {
      Authorization: `Bearer ${CONFIG.KOMMO_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
}

// в”Ђв”Ђв”Ђ WEBHOOK ENDPOINT в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;
    const messages = body?.message?.add || [];

    for (const msg of messages) {
      // ProcesДѓm doar mesaje incoming (de la client)
      if (msg.type !== "incoming") {
        console.log(`вЏ­пёЏ Ignorat mesaj de tip: ${msg.type}`);
        continue;
      }

      const text = msg.text;
      const talkId = msg.talk_id;
      const leadId = msg.element_id;

      if (!text || !talkId) {
        console.log("вљ пёЏ Mesaj fДѓrДѓ text sau talk_id, ignorat");
        continue;
      }

      console.log(`рџ’¬ Mesaj incoming (lead #${leadId}, talk #${talkId}): ${text}`);

      // GenereazДѓ rДѓspuns cu Claude
      const reply = await generateReply(text);
      console.log(`рџ¤– RДѓspuns Claude: ${reply}`);

      // Trimite rДѓspunsul Г®n conversaИ›ia WhatsApp
      const subdomain = body?.account?.subdomain || CONFIG.KOMMO_SUBDOMAIN;
      await sendMessageToKommo(talkId, reply, subdomain);
      console.log(`вњ… RДѓspuns trimis pentru talk #${talkId}`);
    }

    res.json({ status: "ok" });
  } catch (error) {
    console.error("вќЊ Eroare:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// в”Ђв”Ђв”Ђ HEALTH CHECK в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
app.get("/", (req, res) => {
  res.json({ status: "рџџў MOTIV Bot activ", version: "3.0.0", timestamp: new Date().toISOString() });
});

app.listen(CONFIG.PORT, () => {
  console.log(`рџљЂ MOTIV Kommo Bot v3.0 pornit pe portul ${CONFIG.PORT}`);
});
