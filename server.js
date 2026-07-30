require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Identifiants TextingHouse (page "Paramètres" de leur interface API)
const TH_USER = process.env.TEXTINGHOUSE_USER || 'sossoukouam@gmail.com';
const TH_PASS = process.env.TEXTINGHOUSE_PASS || '1tn24m3j79sn3b54pdirsi5r';
const SENDER_DEFAULT = process.env.TEXTINGHOUSE_SENDER || ''; // optionnel, max 11 car. alphanum

const TH_API_URL = 'https://api.textinghouse.com/http/v1/do';
const TH_API_URL_BACKUP = 'https://api2.textinghouse.com/http/v1/do'; // serveur de secours (doc 4.9)

if (TH_USER === 'XXXX' || TH_PASS === 'XXXX') {
  console.warn('⚠️  TEXTINGHOUSE_USER / TEXTINGHOUSE_PASS non configurés (voir .env.example)');
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Analyse la réponse texte brute de TextingHouse : "ID:xxxx" ou "ERR: code | description"
function parseTextingHouseResponse(raw) {
  const text = String(raw).trim();
  if (text.startsWith('ID:')) {
    return { ok: true, id: text.slice(3).trim() };
  }
  if (text.startsWith('ERR:')) {
    const [, rest] = text.split('ERR:');
    const [code, ...descParts] = rest.split('|');
    return { ok: false, code: code.trim(), description: descParts.join('|').trim() };
  }
  return { ok: false, code: 'UNKNOWN', description: text };
}

async function sendViaTextingHouse(params) {
  try {
    const response = await axios.get(TH_API_URL, { params, timeout: 8000 });
    return response.data;
  } catch (err) {
    // Basculement sur le serveur de secours en cas d'échec réseau (doc 4.9)
    console.warn('⚠️  Échec sur api.textinghouse.com, tentative sur api2.textinghouse.com', err.message);
    const response = await axios.get(TH_API_URL_BACKUP, { params, timeout: 8000 });
    return response.data;
  }
}

app.post('/api/send-sms', async (req, res) => {
  const { message, to, senderId } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ ok: false, error: 'Le message est vide.' });
  }

  const destination = to && to.trim() ? to.trim() : process.env.DESTINATION_NUMBER;
  if (!destination || !/^\+[1-9]\d{6,14}$/.test(destination)) {
    return res.status(400).json({ ok: false, error: 'Numéro destinataire invalide. Format attendu : +indicatif + numéro (ex: +2250700000000).' });
  }

  let sender = SENDER_DEFAULT;
  if (senderId && senderId.trim()) {
    if (!/^[A-Za-z0-9]{1,11}$/.test(senderId.trim())) {
      return res.status(400).json({ ok: false, error: "En-tête invalide : 11 caractères max, lettres et chiffres uniquement." });
    }
    sender = senderId.trim();
  }

  // TextingHouse veut le numéro sans le "+" (ex: 33628000000)
  const numeroSansPlus = destination.replace('+', '');

  const params = {
    user: TH_USER,
    pass: TH_PASS,
    cmd: 'sendsms',
    to: numeroSansPlus,
    txt: message,
    iscom: 'N', // message de service (non commercial) — pas de mention STOP requise
  };
  if (sender) params.from = sender;

  try {
    const raw = await sendViaTextingHouse(params);
    const result = parseTextingHouseResponse(raw);

    if (result.ok) {
      console.log(`✅ SMS envoyé, ID TextingHouse : ${result.id}`);
      return res.json({ ok: true, id: result.id, raw });
    }

    console.error(`❌ Erreur TextingHouse ${result.code} : ${result.description}`);
    return res.status(502).json({ ok: false, error: `Erreur ${result.code} : ${result.description}`, raw });
  } catch (err) {
    console.error('Erreur réseau TextingHouse :', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur http://localhost:${PORT}`);
  console.log(`   Les SMS seront envoyés vers : ${process.env.DESTINATION_NUMBER || '(non défini)'}`);
});
