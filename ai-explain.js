// ai-explain.js — rédaction de l'explication DÉTAILLÉE d'une stratégie IA
//
// Chaque stratégie créée par l'analyseur doit être compréhensible sans lire le
// code : d'où elle vient, ce qu'elle observe, quand elle se déclenche, ce
// qu'elle prédit, sur quoi on vérifie, ce que valent ses statistiques et quels
// sont ses risques.
'use strict';

function txt(v, fallback = '') {
  const s = String(v == null ? '' : v).trim();
  return s || fallback;
}

function originLabel(origin) {
  if (origin === 'auto-pollinations') return 'Analyse IA distante (Pollinations.ai)';
  if (origin === 'auto-local') return 'Moteur d’analyse local (temps réel)';
  if (origin === 'cumulative') return 'Analyse cumulative par paliers';
  if (origin === 'day-compare') return 'Comparaison de journées';
  return 'Enregistrement manuel';
}

function reliability(rate, support) {
  const r = Number(rate);
  const s = Number(support);
  if (!Number.isFinite(r)) return 'Fiabilité non mesurée.';
  let level;
  if (r >= 90) level = 'très forte';
  else if (r >= 82) level = 'forte';
  else if (r >= 75) level = 'correcte (juste au-dessus du seuil de 75%)';
  else level = 'insuffisante';
  const sample = Number.isFinite(s) && s > 0
    ? `mesurée sur ${s} observation${s > 1 ? 's' : ''}`
    : 'échantillon non communiqué';
  const warn = Number.isFinite(s) && s > 0 && s < 20
    ? ' ⚠️ Échantillon encore petit : la statistique peut bouger, à confirmer sur plus de jeux.'
    : '';
  return `Réussite ${r}% → fiabilité ${level}, ${sample}.${warn}`;
}

// Explication complète, en français, prête à afficher (web) ou à envoyer (Telegram).
function buildExplanation(item = {}) {
  const lines = [];
  lines.push(`🧠 ${txt(item.name, 'Stratégie IA')}`);
  lines.push('');
  lines.push(`1) Origine — ${originLabel(item.origin)}. Créée le ${new Date(item.createdAt || Date.now()).toLocaleString('fr-FR')}.`);
  lines.push(`2) Ce que la stratégie a observé — ${txt(item.logic, 'régularité détectée dans les mains analysées.')}`);
  lines.push(`3) Quand elle se déclenche — ${txt(item.trigger, 'dès que la configuration décrite ci-dessus réapparaît sur un jeu terminé.')}`);
  lines.push(`4) Ce qu'elle prédit — ${txt(item.target, 'le résultat attendu au tour suivant le déclencheur.')}`);
  lines.push('5) Où l\'on vérifie — la vérification porte sur la MAIN DU JOUEUR du jeu cible, puis sur les rattrapages configurés.');
  lines.push(`6) Preuve chiffrée — ${txt(item.evidence, 'aucune preuve détaillée fournie.')}`);
  lines.push(`7) Fiabilité — ${reliability(item.rate, item.support)}`);
  if (item.minimumSample) lines.push(`8) Échantillon minimum conseillé — ${txt(item.minimumSample)} jeux avant d'accorder confiance.`);
  lines.push(`${item.minimumSample ? 9 : 8}) Risques et limites — ${txt(item.risks, 'un changement de rythme du sabot peut faire disparaître la régularité ; surveiller les pertes consécutives.')}`);
  lines.push(`${item.minimumSample ? 10 : 9}) Comment l'utiliser — la stratégie est enregistrée INACTIVE. Observez-la en mode silencieux sur plusieurs cycles, puis activez l'envoi si le taux se maintient au-dessus de 75%.`);
  return lines.join('\n');
}

// Version courte (badges, listes)
function buildSummary(item = {}) {
  const rate = Number(item.rate);
  const head = Number.isFinite(rate) ? `${rate}% de réussite` : 'taux inconnu';
  return `${head} — ${txt(item.logic, 'régularité détectée')}`.slice(0, 220);
}

// Complète une stratégie enregistrée avec ses explications
function decorate(item = {}) {
  return { ...item, explanation: buildExplanation(item), summary: buildSummary(item) };
}

module.exports = { buildExplanation, buildSummary, decorate, originLabel, reliability };
