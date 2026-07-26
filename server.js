require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Sécurité minimale : on vérifie que les variables essentielles existent
const requiredEnv = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER', 'DESTINATION_NUMBER'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.warn(`⚠️  Variable d'environnement manquante : ${key} (voir .env.example)`);
  }
}

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Route appelée par le bouton "Envoyer" de la page
app.post('/api/send-sms', async (req, res) => {
  const { message, to, senderId } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ ok: false, error: 'Le message est vide.' });
  }

  // Numéro destinataire : celui envoyé par le formulaire (pays + numéro local),
  // sinon on retombe sur DESTINATION_NUMBER défini dans .env
  const destination = to && to.trim() ? to.trim() : process.env.DESTINATION_NUMBER;

  if (!destination || !/^\+[1-9]\d{6,14}$/.test(destination)) {
    return res.status(400).json({ ok: false, error: 'Numéro destinataire invalide. Format attendu : +indicatif + numéro (ex: +22990000000).' });
  }

  // En-tête (nom expéditeur) : celui saisi dans le formulaire, sinon repli sur
  // le numéro Twilio classique. Twilio exige max 11 caractères alphanumériques.
  let from = process.env.TWILIO_FROM_NUMBER;
  if (senderId && senderId.trim()) {
    const cleanSenderId = senderId.trim();
    if (!/^[A-Za-z0-9]{1,11}$/.test(cleanSenderId)) {
      return res.status(400).json({ ok: false, error: "En-tête invalide : 11 caractères max, lettres et chiffres uniquement, sans espace." });
    }
    from = cleanSenderId;
  }

  try {
    const sms = await client.messages.create({
      body: message,
      from,
      to: destination,
    });

    return res.json({ ok: true, sid: sms.sid, status: sms.status });
  } catch (err) {
    console.error('Erreur Twilio :', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur http://localhost:${PORT}`);
  console.log(`   Les SMS seront envoyés vers : ${process.env.DESTINATION_NUMBER || '(non défini)'}`);
});
