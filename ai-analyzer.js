// ai-analyzer.js — analyseur Baccarat
//  1) moteur LOCAL : il analyse lui-même les jeux en temps réel (aucune clé requise)
//  2) enrichissement Pollinations.ai (clé écrite en dur dans config.js)
'use strict';

const config = require('./config');
const miner = require('./pattern-miner');

const MAX_GAMES = 200;   // fenêtre d'analyse élargie (analyse plus fiable)
const MIN_ACCEPTED_RATE = 80; // aucune stratégie sous 80% n'est retenue
const REQUEST_TIMEOUT_MS = 120000;
const FALLBACK_MODELS = ['openai', 'openai-large', 'mistral'];
const SUITS = ['♦️', '❤️', '♣️', '♠️'];

// clé utilisable à chaud (page Analyseur IA) sinon clé en dur du code
let runtimeKey = '';
function setApiKey(key) { runtimeKey = String(key || '').trim(); return apiKey(); }
function apiKey() { return runtimeKey || config.POLLINATIONS.API_KEY || ''; }
function keyLooksValid() {
  const k = apiKey();
  return !!k && k !== 'POLLINATIONS_KEY_A_REMPLACER';
}

function compactGame(game) {
  return {
    n: game.number,
    player: game.player || game.player_cards || [],
    banker: game.banker || game.banker_cards || [],
    playerSuits: game.playerSuits || game.player_suits || [],
    bankerSuits: game.bankerSuits || game.banker_suits || [],
    playerValue: game.playerValue ?? game.player_value ?? null,
    bankerValue: game.bankerValue ?? game.banker_value ?? null,
    winner: game.winner || null,
    finished: game.finished !== false,
  };
}

function extractJson(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try { return JSON.parse(candidate); } catch (_) {}
  const object = candidate.match(/\{[\s\S]*\}/);
  if (!object) return null;
  try { return JSON.parse(object[0]); } catch (_) { return null; }
}

function localSummary(games) {
  const counts = Object.fromEntries(SUITS.map((s) => [s, 0]));
  const recent = games.slice(0, 30);
  for (const game of games) {
    for (const suit of [...(game.playerSuits || []), ...(game.bankerSuits || [])]) {
      if (counts[suit] !== undefined) counts[suit] += 1;
    }
  }
  return {
    games: games.length,
    recentGames: recent.length,
    suitCounts: counts,
    playerWins: games.filter((g) => g.winner === 'Joueur').length,
    bankerWins: games.filter((g) => g.winner === 'Banquier').length,
    ties: games.filter((g) => g.winner === 'Égalité').length,
  };
}

// ---------------------------------------------------------------------------
// MOTEUR LOCAL : l'analyseur fait les analyses lui-même, en temps réel.
// Il regarde la main du JOUEUR (base de vérification) et signale :
//  • absences de costume, séries, dominance, parité des points, cadence.
// Quand un signal est net et suffisamment échantillonné, il rédige une
// stratégie testable, prête à être enregistrée dans « Stratégies IA ».
// ---------------------------------------------------------------------------
function pct(a, b) { return b ? Math.round((a / b) * 1000) / 10 : 0; }

function localAnalysis(rawGames = [], options = {}) {
  const cap = Number(options.maxGames) > 0 ? Number(options.maxGames) : MAX_GAMES;
  const games = rawGames.map(compactGame).filter((g) => g.n != null).slice(0, cap);
  const summary = localSummary(games);
  const findings = [];
  const proposals = [];
  if (games.length < 6) {
    return {
      source: 'local',
      title: 'Analyse en attente de données',
      confidence: 'exploratoire',
      observation: `Seulement ${games.length} jeu(x) disponibles : il en faut au moins 6 pour observer un signal.`,
      findings, strategies: proposals, nextChecks: ['Laisser tourner le flux quelques minutes.'],
      localSummary: summary, sample: games.length, generatedAt: new Date().toISOString(),
    };
  }

  const playerHas = (g, s) => (g.playerSuits || []).includes(s);

  // 1) absence de costume dans la main du joueur
  for (const suit of SUITS) {
    let absence = 0;
    for (const g of games) { if (playerHas(g, suit)) break; absence += 1; }
    const seen = games.filter((g) => playerHas(g, suit)).length;
    if (absence >= 4) {
      findings.push(`${suit} absent de la main du joueur depuis ${absence} jeux (présence globale ${pct(seen, games.length)}%).`);
      if (absence >= 5 && games.length >= 20) {
        proposals.push({
          name: `Retour du costume ${suit} après ${absence} absences`,
          logic: `Quand ${suit} est absent de la main du joueur pendant ${absence} jeux consécutifs, viser son retour sur le jeu suivant.`,
          trigger: `${absence} jeux sans ${suit} côté joueur`,
          target: 'jeu suivant, avec rattrapages',
          suggestedLead: 2,
          minimumSample: 20,
          rate: pct(seen, games.length),
          support: games.length,
          evidence: `Sur ${games.length} jeux observés, ${suit} apparaît dans ${pct(seen, games.length)}% des mains du joueur.`,
          risks: "Une absence longue ne garantit aucun retour : le tirage reste indépendant. À tester en mode silencieux.",
          compatibleExisting: 'absente',
        });
      }
    }
  }

  // 2) dominance d'un costume sur la fenêtre récente
  const recent = games.slice(0, Math.min(30, games.length));
  const recentCounts = Object.fromEntries(SUITS.map((s) => [s, recent.filter((g) => playerHas(g, s)).length]));
  const top = SUITS.slice().sort((a, b) => recentCounts[b] - recentCounts[a])[0];
  const topRate = pct(recentCounts[top], recent.length);
  if (topRate >= 60) {
    findings.push(`${top} domine la main du joueur : ${topRate}% des ${recent.length} derniers jeux.`);
    if (recent.length >= 20) {
      proposals.push({
        name: `Suivi du costume dominant ${top}`,
        logic: `Tant que ${top} reste au-dessus de 60% de présence sur 30 jeux, jouer ${top} côté joueur.`,
        trigger: `${top} présent dans ${topRate}% des mains récentes`,
        target: 'prochain jeu tant que la dominance tient',
        suggestedLead: 2,
        minimumSample: 30,
        rate: topRate,
        support: recent.length,
        evidence: `${recentCounts[top]} présences sur ${recent.length} jeux récents.`,
        risks: 'Une dominance peut se retourner brutalement ; couper dès que la présence repasse sous 50%.',
        compatibleExisting: 'dominant',
      });
    }
  }

  // 3) séries joueur / banquier
  let streak = 1;
  for (let i = 1; i < games.length; i += 1) {
    if (games[i].winner && games[i].winner === games[0].winner) streak += 1; else break;
  }
  if (games[0].winner && streak >= 4) {
    findings.push(`Série en cours : ${streak} victoires « ${games[0].winner} » d'affilée.`);
  }

  // 4) parité des points du joueur
  const values = games.map((g) => g.playerValue).filter((v) => v != null);
  if (values.length >= 10) {
    const even = values.filter((v) => v % 2 === 0).length;
    const rate = pct(even, values.length);
    if (rate >= 65 || rate <= 35) {
      findings.push(`Points du joueur déséquilibrés : ${rate}% de valeurs paires sur ${values.length} jeux.`);
      proposals.push({
        name: `Parité ${rate >= 65 ? 'paire' : 'impaire'} des points joueur`,
        logic: `Suivre la parité ${rate >= 65 ? 'paire' : 'impaire'} des points du joueur tant que le déséquilibre dépasse 65/35.`,
        trigger: `${rate}% de points pairs sur ${values.length} jeux`,
        target: 'prochain jeu',
        suggestedLead: 1,
        minimumSample: 30,
        rate: rate >= 65 ? rate : 100 - rate,
        support: values.length,
        evidence: `${even} points pairs sur ${values.length} relevés.`,
        risks: 'Déséquilibre possiblement dû au hasard : vérifier sur un second échantillon avant publication.',
        compatibleExisting: 'parite',
      });
    }
  }

  // 5) égalités
  if (summary.ties && pct(summary.ties, games.length) >= 12) {
    findings.push(`Taux d'égalités élevé : ${pct(summary.ties, games.length)}% des jeux analysés.`);
  }

  // ---------------------------------------------------------------------
  // DÉCOUVERTE : l'analyseur cherche des régularités qu'aucune stratégie
  // existante ne décrit (carte précise -> costume futur, points, chaînes,
  // séquences de vainqueurs, répétition d'une journée déjà jouée).
  // ---------------------------------------------------------------------
  const mined = miner.mine(rawGames, {
    lead: options.lead || 2,
    pastDays: options.pastDays || [],
    todayGames: options.todayGames || rawGames,
  });
  for (const f of mined.findings) findings.push(f);
  for (const p of mined.proposals) proposals.push(p);
  for (const r of mined.replacements) {
    findings.push(r.text);
    proposals.push({
      name: `Remplacer ${r.from} par ${r.to} (jeu a+${r.lead})`,
      logic: `Quand le déclencheur ${r.from} est vu côté joueur, prédire ${r.to} au lieu de ${r.from} sur le jeu a+${r.lead}.`,
      trigger: `${r.from} vu dans la main du joueur`,
      target: `jeu a+${r.lead}`,
      suggestedLead: r.lead,
      minimumSample: 25,
      rate: r.rate,
      support: r.support,
      evidence: `${r.rate}% pour ${r.to} contre ${r.currentRate}% pour ${r.from} sur ${r.support} observations.`,
      risks: "Remplacement à tester en mode silencieux avant de modifier une stratégie publiée.",
      compatibleExisting: 'costume',
    });
  }

  const confidence = proposals.length ? (games.length >= 40 ? 'moyenne' : 'faible') : 'exploratoire';
  return {
    source: 'local',
    discoveries: mined.discoveries || [],
    replacements: mined.replacements || [],
    dayMatches: mined.dayMatches || [],
    title: findings.length ? findings[0] : 'Aucun signal marquant pour l’instant',
    confidence,
    observation: findings.length
      ? `L’analyseur a relevé ${findings.length} signal(aux) sur ${games.length} jeux : ${findings.join(' ')}`
      : `Rien de significatif sur les ${games.length} derniers jeux : fréquences proches de l’équilibre.`,
    findings,
    strategies: proposals,
    nextChecks: [
      'Confirmer chaque signal sur les 20 prochains jeux',
      'Tester la règle en mode silencieux avant publication',
    ],
    localSummary: summary,
    sample: games.length,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Contrôle qualité des stratégies renvoyées par l'IA distante
//  • un taux non mesuré ou < 80% est refusé
//  • une règle machine mal formée est nettoyée (la stratégie reste lisible,
//    mais elle ne pourra pas être rejouée automatiquement)
// ---------------------------------------------------------------------------
const RULE_KINDS = ['carte', 'point', 'chaine'];

function cleanRule(rule) {
  if (!rule || typeof rule !== 'object') return null;
  const kind = RULE_KINDS.includes(rule.kind) ? rule.kind : null;
  const suit = SUITS.includes(rule.suit) ? rule.suit : null;
  const k = Math.max(1, Math.min(3, parseInt(rule.k, 10) || 0));
  if (!kind || !suit || !k) return null;
  const hand = rule.hand === 'banquier' ? 'banquier' : 'joueur';
  if (kind === 'point') {
    const value = parseInt(rule.value, 10);
    if (!Number.isFinite(value) || value < 0 || value > 9) return null;
    return { kind, hand: 'joueur', token: `point ${value}`, value, k, suit };
  }
  const token = String(rule.token || '').trim();
  if (!token) return null;
  return { kind, hand, token, k, suit };
}

function sanitizeStrategies(list, fallback = []) {
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || !item.name) continue;
    const rate = Math.round(Number(item.rate));
    const support = Math.round(Number(item.support));
    if (!Number.isFinite(rate) || rate < MIN_ACCEPTED_RATE || rate > 100) continue;
    if (!Number.isFinite(support) || support < 6) continue;
    out.push({ ...item, rate, support, rule: cleanRule(item.rule) });
  }
  out.sort((a, b) => b.rate - a.rate || b.support - a.support);
  // si l'IA distante ne fournit rien d'exploitable, on garde les propositions
  // mesurées par le moteur local (elles portent déjà leurs chiffres).
  return out.length ? out : (fallback || []).filter((p) => Number(p.rate) >= MIN_ACCEPTED_RATE);
}

// ---------------------------------------------------------------------------
// Enrichissement Pollinations.ai
// ---------------------------------------------------------------------------
async function analyze({ games = [], date = null, objective = '', pastDays = [] } = {}) {
  if (!keyLooksValid()) {
    const error = new Error("Clé Pollinations.ai absente : renseigne-la dans le code (config.js) ou depuis la page Analyseur IA.");
    error.code = 'AI_NOT_CONFIGURED';
    throw error;
  }

  const normalized = games.map(compactGame).filter((game) => game.n != null).slice(0, MAX_GAMES);
  if (normalized.length < 6) {
    const error = new Error('Il faut au moins 6 jeux terminés pour produire une analyse utile.');
    error.code = 'NOT_ENOUGH_DATA';
    throw error;
  }

  const summary = localSummary(normalized);
  const local = localAnalysis(games, { pastDays });
  const system = [
    'Tu es un analyste quantitatif rigoureux de parties de Baccarat.',
    'Tu analyses UNIQUEMENT les jeux fournis ; tu ne promets jamais une prédiction certaine et tu ne fabriques aucun chiffre.',
    'La main du JOUEUR est la seule base de vérification ; la main du banquier ne sert qu\'au contexte.',
    'Méthode imposée : (1) compter, (2) mesurer un taux de réussite réel sur les jeux fournis, (3) ne proposer une règle QUE si tu peux donner le nombre de succès et le nombre d\'observations.',
    'Chaque stratégie DOIT contenir "rate" (nombre entier 0-100, mesuré) et "support" (nombre d\'observations). Une règle sous 80% de réussite ou sous 6 observations doit être écartée, pas proposée.',
    'Chaque stratégie DOIT aussi contenir un objet "rule" exploitable par machine : { "kind": "carte|point|chaine", "hand": "joueur|banquier", "token": "6❤️ ou ♦️", "value": 8, "k": 1|2|3, "suit": "♦️|❤️|♣️|♠️" }.',
    'Ne te limite JAMAIS aux stratégies déjà existantes : cherche de NOUVELLES régularités.',
    'Exemples : « quand le joueur ou le banquier a eu 6❤️ au jeu a, ♣️ arrive au jeu a+2 », « la partie du 20/08/2026 se rejoue aujourd\'hui », « telle séquence de vainqueurs annonce le suivant », « il faut remplacer le costume prédit par un autre quand le déclencheur est vu ».',
    'Cherche fréquences, séries, absences, distributions, décalages (a+1, a+2, a+3), répétitions de journées, et signale explicitement les risques de sur-ajustement.',
    'Trie tes stratégies de la plus fiable à la moins fiable et explique en français clair, en une phrase, pourquoi la régularité tient.',
    'Réponds uniquement avec un JSON valide, sans Markdown.',
  ].join(' ');
  const user = {
    demande: objective || 'Identifier les signaux observables et proposer des stratégies testables pour les prochains jeux.',
    exigences: {
      seuilMinimumReussite: MIN_ACCEPTED_RATE,
      observationsMinimum: 6,
      regleMachineObligatoire: true,
      interdits: ['inventer un chiffre', 'proposer une règle non mesurée', 'promettre une certitude'],
    },
    dateAnalysee: date || 'historique disponible',
    resumeLocal: summary,
    signauxDetectesLocalement: local.findings,
    reglesDecouvertesLocalement: local.discoveries || [],
    remplacementsDeCostumeConseilles: local.replacements || [],
    journeesSimilaires: local.dayMatches || [],
    jeux: normalized,
    formatReponse: {
      title: 'titre court',
      confidence: 'faible|moyenne|exploratoire',
      observation: 'résumé factuel',
      strategies: [{
        name: 'nom',
        logic: 'règle testable en une phrase',
        trigger: 'déclencheur',
        target: 'tour ou condition ciblée',
        suggestedLead: 1,
        minimumSample: 20,
        rate: 87,
        support: 23,
        rule: { kind: 'carte', hand: 'joueur', token: '6❤️', k: 2, suit: '♣️' },
        evidence: 'ce que les données montrent (succès / observations)',
        risks: 'risques et limites',
        compatibleExisting: 'costume|dominant|matchnul|parite|absente|ombre|null',
      }],
      replacements: [{ from: '♦️', to: '♣️', lead: 2, text: "d'après mes analyses, remplace ♦️ par ♣️ quand le déclencheur est vu" }],
      nextChecks: ['contrôles à faire sur les prochains jeux'],
    },
  };

  const payloadMessages = [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(user) },
  ];

  // Appel renforcé : jusqu'à 3 tentatives, avec repli sur un autre modèle si le
  // premier échoue ou renvoie une réponse inexploitable.
  const models = [config.POLLINATIONS.MODEL, ...FALLBACK_MODELS.filter((m) => m !== config.POLLINATIONS.MODEL)];
  let body = null;
  let lastError = null;
  for (const model of models.slice(0, 3)) {
    try {
      const response = await fetch(config.POLLINATIONS.CHAT_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey()}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.15,
          top_p: 0.9,
          messages: payloadMessages,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const parsed = await response.json().catch(() => ({}));
      if (!response.ok) {
        lastError = new Error(parsed?.error?.message || `Pollinations.ai a répondu ${response.status}.`);
        lastError.code = 'AI_REQUEST_FAILED';
        continue;
      }
      body = parsed;
      break;
    } catch (e) {
      lastError = e;
    }
  }
  if (!body) {
    const error = lastError || new Error('Pollinations.ai injoignable.');
    error.code = error.code || 'AI_REQUEST_FAILED';
    throw error;
  }

  const text = body?.choices?.[0]?.message?.content || body?.choices?.[0]?.text || '';
  const result = extractJson(text);
  if (!result) {
    const error = new Error('La réponse de Pollinations.ai n’est pas un JSON exploitable.');
    error.code = 'AI_INVALID_RESPONSE';
    throw error;
  }
  return {
    ...result,
    strategies: sanitizeStrategies(result.strategies, local.strategies),
    source: 'pollinations',
    findings: Array.isArray(result.findings) && result.findings.length ? result.findings : local.findings,
    discoveries: local.discoveries || [],
    replacements: Array.isArray(result.replacements) && result.replacements.length ? result.replacements : local.replacements || [],
    dayMatches: local.dayMatches || [],
    generatedAt: new Date().toISOString(),
    sample: normalized.length,
    localSummary: summary,
  };
}

async function listModels() {
  const res = await fetch(config.POLLINATIONS.MODELS_URL, {
    headers: keyLooksValid() ? { authorization: `Bearer ${apiKey()}` } : {},
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => ({}));
  return (body.data || []).map((m) => m.id);
}

module.exports = {
  analyze, localAnalysis, compactGame, localSummary, listModels,
  setApiKey, apiKey, keyLooksValid, MAX_GAMES,
  sanitizeStrategies, cleanRule, MIN_ACCEPTED_RATE,
};
