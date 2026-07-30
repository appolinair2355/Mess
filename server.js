require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const API_KEY = process.env.PROSMS_API_KEY;
const API_PASS = process.env.PROSMS_API_PASS;
const SENDER_DEFAULT = process.env.PROSMS_SENDER_ID || 'MonSite';

if (!API_KEY || !API_PASS) {
  console.warn('⚠️  PROSMS_API_KEY / PROSMS_API_PASS manquants dans .env');
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// On ne connaît pas encore l'URL/paramètres exacts de prosms.pro.
// Le tableau ci-dessous liste plusieurs variantes courantes
// (noms de domaine + noms de paramètres) utilisées par ce type de
// passerelle SMS ("API Impressiv'"). Le serveur les essaie une par
// une dans l'ordre, jusqu'à obtenir une réponse qui ressemble à
// un succès. La première variante qui fonctionne sera loguée dans
// la console — il suffira ensuite de ne garder que celle-là.
// ============================================================
function buildCandidates({ to, sender, message }) {
  const bases = [
    'https://www.prosms.pro/api/sendsms.php',
    'https://www.prosms.pro/api/send.php',
    'https://www.prosms.pro/api/httpsms.php',
    'https://dashboard.prosms.pro/api/sendsms.php',
    'https://dashboard.prosms.pro/api/send.php',
    'https://dashboard.prosms.pro/api/httpsms.php',
  ];

  const paramSets = [
    { apikey: API_KEY, apipass: API_PASS, to, sender, message },
    { apikey: API_KEY, apipass: API_PASS, destinataire: to, expediteur: sender, message },
    { key: API_KEY, pass: API_PASS, to, from: sender, text: message },
    { api_key: API_KEY, api_pass: API_PASS, to, sender, message },
    { user: API_KEY, pass: API_PASS, to, sender, msg: message },
    { apikey: API_KEY, apipass: API_PASS, numero: to, sender, message },
  ];

  const candidates = [];
  for (const base of bases) {
    for (const params of paramSets) {
      candidates.push({ url: base, params });
    }
  }
  return candidates;
}

// Une réponse est considérée "probablement réussie" si elle ne contient
// pas de mot-clé d'erreur évident. On ajustera cette heuristique une
// fois qu'on connaît le vrai format de réponse de prosms.pro.
function looksSuccessful(data) {
  const text = (typeof data === 'string' ? data : JSON.stringify(data)).toLowerCase();
  const errorHints = ['error', 'erreur', 'invalid', 'not found', '404', 'unauthorized', 'denied', 'html>'];
  return !errorHints.some((hint) => text.includes(hint));
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

  const numeroSansPlus = destination.replace('+', '');
  const candidates = buildCandidates({ to: numeroSansPlus, sender, message });

  const attempts = [];
  for (const candidate of candidates) {
    try {
      const response = await axios.get(candidate.url, { params: candidate.params, timeout: 8000 });
      attempts.push({ url: candidate.url, params: candidate.params, status: response.status, data: response.data });

      if (looksSuccessful(response.data)) {
        console.log('✅ Variante qui semble avoir fonctionné :');
        console.log('   URL     :', candidate.url);
        console.log('   Params  :', JSON.stringify(candidate.params));
        console.log('   Réponse :', response.data);
        return res.json({ ok: true, workingUrl: candidate.url, workingParams: candidate.params, raw: response.data });
      }
    } catch (err) {
      attempts.push({
        url: candidate.url,
        params: candidate.params,
        error: err.response ? `HTTP ${err.response.status}` : err.message,
      });
    }
  }

  console.error('❌ Aucune variante n\'a fonctionné. Détail des tentatives :', JSON.stringify(attempts, null, 2));
  return res.status(500).json({
    ok: false,
    error: "Aucune combinaison URL/paramètres n'a fonctionné. Voir les tentatives dans la console du serveur, ou fournis la doc exacte de prosms.pro.",
    attempts,
  });
});

app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur http://localhost:${PORT}`);
  console.log(`   Les SMS seront envoyés vers : ${process.env.DESTINATION_NUMBER || '(non défini)'}`);
});
