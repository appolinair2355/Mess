// predit.js — panneau « Prédit » : prédictions automatiques 100% sûres
//
//  • SEULES les stratégies CRÉÉES PAR L'IA (règles découvertes par l'analyseur
//    et enregistrées dans « Stratégies IA ») entrent dans ce panneau. Les
//    stratégies existantes du bot ne sont JAMAIS utilisées ici.
//  • Seuil d'entrée : 80% de réussite mesurée.
//      – 80% → 99% : la stratégie prédit exactement 2 fois puis se met en pause.
//      – 100%      : la stratégie prédit en continu, sans quota, TANT QU'ELLE
//        reste à 100%. Dès qu'elle passe sous 100% (première perte), elle est
//        retirée immédiatement.
//  • Le message envoyé dans le canal utilise le FORMAT DE PRÉDICTION CONFIGURÉ
//    (les 88 formats). Le motif de la prédiction n'apparaît jamais dans le
//    message : il est gardé dans l'historique de la stratégie.
//  • Chaque stratégie certifiée ne prédit qu'un nombre configuré de fois
//    (ex. 2). Ensuite elle est mise en pause et le panneau attend une NOUVELLE
//    stratégie à 100% pour continuer à prédire.
//  • Dès qu'une stratégie certifiée perd, elle est retirée automatiquement.
'use strict';

const miner = require('./pattern-miner');
const strategies = require('./strategies');
const store = require('./store');
const fmt = require('./formats');
const { state } = require('./predictor');

const SUITS = ['♦️', '❤️', '♣️', '♠️'];

const panel = {
  enabled: true,
  channels: [],        // canaux Telegram du panneau
  minSample: 6,        // observations minimum pour certifier une règle
  minRate: 80,         // taux de réussite minimum accepté (80 → 100%)
  maxR: 1,             // rattrapages autorisés sur une prédiction du panneau
  format: 1,           // format de prédiction utilisé pour les messages
  perStrategy: 2,      // prédictions autorisées pour une stratégie de 80% à 99%
  requireCombo: false, // n'envoyer QUE les prédictions confirmées par 2 règles
  certified: [],       // règles IA actuellement à 100%
  retired: [],         // règles retirées (perdues ou quota atteint)
  predictions: [],     // prédictions du panneau (les 200 dernières)
  sentCount: 0,
  lastSentAt: null,
  lastScanAt: null,
  lastError: null,
};

let sender = null;
function setSender(fn) { sender = fn; }

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
function parseChannels(value) {
  const list = Array.isArray(value) ? value : String(value == null ? '' : value).split(/[\s,;]+/);
  const out = [];
  for (const raw of list) {
    const t = String(raw == null ? '' : raw).trim();
    if (!t) continue;
    if (/^-?\d+$/.test(t)) {
      const n = Number(t);
      if (Number.isFinite(n) && n !== 0 && !out.includes(n)) out.push(n);
    } else {
      const name = t.startsWith('@') ? t : `@${t.replace(/^https?:\/\/t\.me\//i, '')}`;
      if (name.length > 2 && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

function configure(patch = {}) {
  if (patch.enabled !== undefined) panel.enabled = !!patch.enabled;
  if (patch.requireCombo !== undefined) panel.requireCombo = !!patch.requireCombo;
  if (patch.channels !== undefined) panel.channels = parseChannels(patch.channels);
  if (patch.minRate !== undefined) {
    const v = parseInt(patch.minRate, 10);
    // le panneau n'accepte jamais moins de 80% : c'est la règle de service.
    panel.minRate = Math.max(80, Math.min(100, Number.isFinite(v) ? v : 80));
  }
  if (patch.minSample !== undefined) panel.minSample = Math.max(3, Math.min(60, parseInt(patch.minSample, 10) || 6));
  if (patch.maxR !== undefined) panel.maxR = Math.max(0, Math.min(5, parseInt(patch.maxR, 10) || 0));
  if (patch.format !== undefined) panel.format = fmt.clampFormat(patch.format);
  if (patch.perStrategy !== undefined) panel.perStrategy = Math.max(1, Math.min(50, parseInt(patch.perStrategy, 10) || 1));
  persist();
  return config();
}

function config() {
  return {
    enabled: panel.enabled,
    channels: panel.channels,
    minSample: panel.minSample,
    minRate: panel.minRate,
    maxR: panel.maxR,
    format: panel.format,
    perStrategy: panel.perStrategy,
    requireCombo: panel.requireCombo,
  };
}

function persist() {
  try { store.patch({ predit: config() }); } catch (_) {}
}

function restore() {
  try {
    const saved = (store.read() || {}).predit;
    if (saved) configure({ ...saved });
  } catch (_) {}
  return config();
}

// ---------------------------------------------------------------------------
// Lecture des jeux
// ---------------------------------------------------------------------------
function orderedGames() {
  return miner.normalize(state.history || []);
}

function suitsOf(game) {
  return strategies.suitsOf(game && game.playerSuits ? game.playerSuits : []);
}

function cardTokens(game, hand) {
  const cards = hand === 'banquier' ? (game.bankerCards || []) : (game.playerCards || []);
  const out = new Set();
  for (const card of cards) {
    const text = String(card || '');
    const suit = SUITS.find((s) => text.includes(s.charAt(0)));
    if (!suit) continue;
    const rank = text.replace(suit, '').replace(/\uFE0F/g, '').trim() || '?';
    out.add(`${rank}${suit}`);
  }
  return out;
}

// la règle est-elle déclenchée par ce jeu ?
function triggered(rule, game) {
  if (!rule || !game) return false;
  if (rule.kind === 'carte') return cardTokens(game, rule.hand).has(rule.token);
  if (rule.kind === 'point') return game.playerValue != null && Number(game.playerValue) === Number(rule.value);
  if (rule.kind === 'chaine') return suitsOf(game).includes(rule.token);
  return false;
}

// ---------------------------------------------------------------------------
// Paliers de service
//   • 100%        → prédictions illimitées tant que le 100% tient
//   • 80% → 99%   → 2 prédictions (panel.perStrategy) puis pause
// ---------------------------------------------------------------------------
function isPerfect(entry) {
  return Number(entry && entry.rate) >= 100;
}

function quotaFor(entry) {
  return isPerfect(entry) ? Infinity : panel.perStrategy;
}

function quotaLabel(entry) {
  return isPerfect(entry) ? '∞ (continu tant que 100%)' : String(panel.perStrategy);
}

function tierLabel(entry) {
  return isPerfect(entry)
    ? '100% — prédit en continu jusqu’à sa première perte'
    : `${entry.rate}% — ${panel.perStrategy} prédiction(s) autorisée(s)`;
}

// taux réel : mesure d'origine corrigée par les résultats vécus dans le panneau
function liveRate(entry) {
  const total = (entry.win || 0) + (entry.loss || 0);
  if (!total) return Number(entry.rate) || 0;
  const live = Math.round(((entry.win || 0) / total) * 100);
  return Math.min(Number(entry.rate) || 0, live);
}

// ---------------------------------------------------------------------------
// Certification : SEULES les stratégies créées par l'IA (≥ 80%) entrent ici
//   • règles découvertes en direct par le mineur de motifs
//   • stratégies enregistrées dans « Stratégies IA » qui portent une règle
// ---------------------------------------------------------------------------
function ruleId(rule) {
  return `ia:${rule.kind}:${rule.hand}:${rule.token}:${rule.k}:${rule.suit}`;
}

// stratégies IA enregistrées (ai-auto / analyse distante) réutilisables ici
function savedAiCandidates() {
  const out = [];
  for (const s of state.aiStrategies || []) {
    if (!s || !s.rule || !s.rule.suit) continue;
    const rate = Number(s.rate);
    if (!Number.isFinite(rate) || rate < panel.minRate) continue;
    if (Number(s.support || 0) < panel.minSample) continue;
    out.push({
      rule: s.rule,
      rate,
      support: Number(s.support) || 0,
      name: s.name,
      finding: s.summary || s.logic || s.name,
      motif: s.logic || s.name,
      trigger: s.trigger || '',
      explanation: s.explanation || '',
      origin: s.origin || 'ia',
    });
  }
  return out;
}

function certifyDiscoveries() {
  const found = miner.mine(state.history || [], { lead: 2 });
  const mined = (found.discoveries || [])
    .filter((d) => d.rule && Number(d.rate) >= panel.minRate && Number(d.support || 0) >= panel.minSample)
    .map((d) => ({
      rule: d.rule,
      rate: Number(d.rate),
      support: Number(d.support) || 0,
      name: (d.proposal && d.proposal.name) || d.finding,
      finding: d.finding,
      motif: (d.proposal && d.proposal.logic) || d.finding,
      trigger: (d.proposal && d.proposal.trigger) || '',
      explanation: '',
      origin: 'mineur-ia',
    }));

  for (const c of [...mined, ...savedAiCandidates()]) {
    const id = ruleId(c.rule);
    const existing = panel.certified.find((e) => e.id === id);
    if (existing) {
      // une stratégie déjà en service voit son taux réévalué ; si elle repasse
      // à 100% son quota redevient illimité, si elle chute elle sera retirée.
      existing.rate = Math.min(c.rate, liveRate(existing) || c.rate);
      existing.sample = c.support;
      if (existing.rate < panel.minRate) {
        retire(existing, `Le taux mesuré est retombé à ${existing.rate}% (< ${panel.minRate}%).`);
      }
      continue;
    }
    const retired = panel.retired.find((r) => r.id === id);
    // une stratégie retirée ne revient QUE si l'IA la remesure à 100%
    if (retired && c.rate < 100) continue;
    if (retired) panel.retired = panel.retired.filter((r) => r.id !== id);
    panel.certified.push({
      id,
      type: 'ia',
      name: c.name,
      finding: c.finding,
      motif: c.motif,
      trigger: c.trigger,
      explanation: c.explanation,
      origin: c.origin,
      rule: c.rule,
      rate: c.rate,
      sample: c.support,
      used: 0,
      win: 0,
      loss: 0,
      certifiedAt: new Date().toISOString(),
    });
  }
  return panel.certified;
}

function retire(entry, reason) {
  panel.certified = panel.certified.filter((c) => c.id !== entry.id);
  panel.retired = [{ ...entry, reason, retiredAt: new Date().toISOString() }, ...panel.retired].slice(0, 30);
}

// stratégies au-dessus du seuil ET qui n'ont pas épuisé leur quota de palier
function activeCertified() {
  return panel.certified.filter((c) => c.rate >= panel.minRate && (c.used || 0) < quotaFor(c));
}

// ---------------------------------------------------------------------------
// Prédictions du panneau
// ---------------------------------------------------------------------------
function lastFinishedNumber(games) {
  return games.length ? games[games.length - 1].n : 0;
}

function motifOf(entry, game, target) {
  return [
    entry.trigger ? `Déclencheur : ${entry.trigger}` : null,
    `Vu au jeu #N${game.n} → prédiction sur #N${target}`,
    entry.motif || entry.finding || '',
    `Fiabilité mesurée : ${entry.rate}% sur ${entry.sample} observation(s)`,
    `Palier : ${tierLabel(entry)}`,
  ].filter(Boolean).join(' · ');
}

function makePredictions(games) {
  const last = lastFinishedNumber(games);
  if (!last) return [];
  const created = [];
  for (const entry of activeCertified()) {
    if (!entry.rule) continue;
    for (let i = games.length - 1; i >= 0 && i >= games.length - 6; i -= 1) {
      const g = games[i];
      if (!triggered(entry.rule, g)) continue;
      const target = g.n + entry.rule.k;
      if (target <= last) continue; // le jeu cible est déjà joué
      if (panel.predictions.some((p) => p.source === entry.id && p.target === target)) continue;
      const pred = {
        id: `predit-${entry.id}-${target}`,
        source: entry.id,
        sources: [{ id: entry.id, name: entry.name, rate: entry.rate, sample: entry.sample }],
        sourceName: entry.name,
        // le motif reste dans l'historique de la stratégie, jamais dans le message
        motif: motifOf(entry, g, target),
        trigger: g.n,
        target,
        suit: entry.rule.suit,
        step: 0,
        maxR: panel.maxR,
        status: 'en attente',
        combo: false,
        messages: [],
        createdAt: new Date().toISOString(),
      };
      panel.predictions.unshift(pred);
      entry.used = (entry.used || 0) + 1;
      created.push(pred);
      if ((entry.used || 0) >= quotaFor(entry)) entry.quotaAt = new Date().toISOString();
      break;
    }
  }
  panel.predictions = panel.predictions.slice(0, 200);
  return created;
}

// Deux règles certifiées qui visent le même jeu avec le même costume :
// elles prédisent ensemble (double confirmation).
function mergeCombos(created) {
  const out = [];
  for (const pred of created) {
    const twin = panel.predictions.find(
      (p) => p !== pred && p.target === pred.target && p.suit === pred.suit && p.status === 'en attente',
    );
    if (twin) {
      twin.combo = true;
      twin.sources = [...twin.sources, ...pred.sources];
      twin.motif = [twin.motif, pred.motif].filter(Boolean).join('\n');
      panel.predictions = panel.predictions.filter((p) => p !== pred);
      if (!out.includes(twin)) out.push(twin);
      twin.resend = true;
    } else {
      out.push(pred);
    }
  }
  return out;
}

function gameByNumber(games, n) {
  return games.find((g) => g.n === n) || null;
}

function verify(games) {
  const last = lastFinishedNumber(games);
  const closed = [];
  for (const pred of panel.predictions) {
    if (pred.status !== 'en attente') continue;
    let checked = pred.target + pred.step;
    while (checked <= last) {
      const g = gameByNumber(games, checked);
      if (!g) { checked += 1; continue; }
      if (suitsOf(g).includes(pred.suit)) {
        pred.status = 'gagné';
        pred.closedAt = new Date().toISOString();
        closed.push(pred);
        break;
      }
      if (pred.step >= pred.maxR) {
        pred.status = 'perdu';
        pred.closedAt = new Date().toISOString();
        closed.push(pred);
        break;
      }
      pred.step += 1;
      checked += 1;
    }
  }
  // une règle certifiée qui perd sort immédiatement du panneau
  for (const pred of closed) {
    for (const src of pred.sources) {
      const entry = panel.certified.find((c) => c.id === src.id);
      if (!entry) continue;
      const wasPerfect = isPerfect(entry);
      if (pred.status === 'gagné') {
        entry.win += 1;
        // une stratégie à 100% qui gagne reste à 100% : elle continue de prédire
      } else {
        entry.loss += 1;
        entry.rate = liveRate(entry);
        retire(entry, wasPerfect
          ? `Perte sur le jeu #N${pred.target} : la stratégie n'est plus à 100% (${entry.rate}%), elle s'arrête ici.`
          : `Perte sur le jeu #N${pred.target} : la règle passe sous le seuil de ${panel.minRate}% (${entry.rate}%).`);
        continue;
      }
      // quota de palier atteint (80→99% : 2 prédictions) : la stratégie sort du
      // service. Une stratégie à 100% a un quota illimité et n'est jamais ici.
      if ((entry.used || 0) >= quotaFor(entry) && !panel.predictions.some(
        (p) => p.status === 'en attente' && p.sources.some((s) => s.id === entry.id),
      )) {
        retire(entry, `Quota atteint : ${entry.used} prédiction(s) envoyée(s) pour une stratégie à ${entry.rate}%. Le panneau attend une nouvelle stratégie à ${panel.minRate}% ou plus.`);
      }
    }
  }
  return closed;
}

// ---------------------------------------------------------------------------
// Messages Telegram — format configuré, AUCUN motif visible
// ---------------------------------------------------------------------------
function predictionText(pred) {
  return fmt.renderMessage(panel.format, {
    gameNumber: pred.target,
    suit: pred.suit,
    strategy: 'Prédit',
    maxR: pred.maxR,
    status: pred.status,
    rattrapage: pred.step,
  });
}

async function send(pred) {
  const bot = typeof sender === 'function' ? sender() : null;
  if (!bot) { panel.lastError = 'Aucun token Telegram configuré'; return false; }
  if (!panel.channels.length) { panel.lastError = 'Aucun canal configuré pour le panneau Prédit'; return false; }
  const out = predictionText(pred);
  let ok = false;
  for (const id of panel.channels) {
    try {
      const m = await bot.sendMessage(id, out.text, out.parse_mode ? { parse_mode: out.parse_mode } : {});
      pred.messages.push({ chatId: id, messageId: m.message_id });
      panel.sentCount += 1;
      panel.lastSentAt = Date.now();
      panel.lastError = null;
      ok = true;
    } catch (e) {
      panel.lastError = `${id} : ${e.message}`;
    }
  }
  return ok;
}

async function update(pred) {
  const bot = typeof sender === 'function' ? sender() : null;
  if (!bot || !pred.messages.length) return;
  const out = predictionText(pred);
  for (const m of pred.messages) {
    try {
      await bot.editMessageText(out.text, {
        chat_id: m.chatId, message_id: m.messageId,
        ...(out.parse_mode ? { parse_mode: out.parse_mode } : {}),
      });
    } catch (_) {}
  }
}

// Les stratégies existantes du bot ne sont plus reprises dans « Prédit ».
async function mirror() { return false; }

// ---------------------------------------------------------------------------
// Historique séparé par stratégie + bilan par stratégie
// ---------------------------------------------------------------------------
function predRow(p) {
  return {
    target: p.target, suit: p.suit, status: p.status, step: p.step, maxR: p.maxR,
    combo: p.combo, sources: p.sources.map((s) => s.name), motif: p.motif || '',
    createdAt: p.createdAt, published: p.messages.length > 0,
  };
}

function bilanOf(list) {
  const done = list.filter((p) => p.status !== 'en attente');
  const win = done.filter((p) => p.status === 'gagné').length;
  const loss = done.length - win;
  return { total: list.length, win, loss, pending: list.length - done.length, rate: done.length ? Math.round((win / done.length) * 100) : 0 };
}

function bilanText(entry, list) {
  const b = bilanOf(list);
  return (
    '📊 STATISTIQUE 📈\n\n' +
    `🧠 Stratégie IA : ${entry.name}\n\n` +
    `🟢 GAIN : ${b.win}\n` +
    `🔴 PERTE : ${b.loss}\n\n` +
    `✅ Taux de réussite : ${b.rate} %`
  );
}

function strategiesView() {
  const all = [...panel.certified, ...panel.retired];
  const seen = new Set();
  const out = [];
  for (const entry of all) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const list = panel.predictions.filter((p) => p.sources.some((s) => s.id === entry.id));
    out.push({
      id: entry.id,
      name: entry.name,
      motif: entry.motif || entry.finding || '',
      finding: entry.finding || '',
      rate: entry.rate,
      sample: entry.sample,
      used: entry.used || 0,
      quota: quotaLabel(entry),
      tier: tierLabel(entry),
      perfect: isPerfect(entry),
      explanation: entry.explanation || '',
      origin: entry.origin || 'ia',
      active: panel.certified.some((c) => c.id === entry.id) && entry.rate >= panel.minRate,
      waiting: (entry.used || 0) >= quotaFor(entry),
      reason: entry.reason || null,
      certifiedAt: entry.certifiedAt,
      bilan: bilanOf(list),
      bilanText: bilanText(entry, list),
      predictions: list.slice(0, 20).map(predRow), // 20 dernières de CETTE stratégie
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Boucle
// ---------------------------------------------------------------------------
let busy = false;
async function tick() {
  if (busy || !panel.enabled) return panel;
  busy = true;
  try {
    const games = orderedGames();
    if (games.length >= 12) certifyDiscoveries();
    const closed = verify(games);
    for (const pred of closed) await update(pred);
    const created = mergeCombos(makePredictions(games));
    // prédictions encore valables mais jamais publiées (canal absent, erreur
    // Telegram, bot redémarré) : on retente l'envoi à chaque tour.
    const last = lastFinishedNumber(games);
    const unsent = panel.predictions.filter(
      (p) => p.status === 'en attente' && !p.messages.length && p.target > last && !created.includes(p),
    );
    for (const pred of [...created, ...unsent]) {
      if (panel.requireCombo && !pred.combo) continue;
      if (pred.messages.length && !pred.resend) continue;
      pred.resend = false;
      await send(pred);
    }
    if (!panel.certified.length) {
      panel.lastError = panel.channels.length
        ? `Aucune stratégie IA au-dessus de ${panel.minRate}% pour l'instant : rien à envoyer.`
        : 'Aucun canal configuré pour le panneau Prédit';
    }
    panel.lastScanAt = Date.now();
  } catch (e) {
    panel.lastError = e.message;
  } finally {
    busy = false;
  }
  return panel;
}

async function test() {
  const bot = typeof sender === 'function' ? sender() : null;
  if (!bot) return { ok: false, error: 'Aucun token Telegram configuré' };
  if (!panel.channels.length) return { ok: false, error: 'Aucun canal configuré' };
  const preview = fmt.formatPreview(panel.format, { maxR: panel.maxR });
  const sent = [];
  const errors = [];
  for (const id of panel.channels) {
    try {
      await bot.sendMessage(id, `🎯 PRÉDIT — message de test\n\nFormat ${panel.format} :\n\n${preview}`);
      sent.push(String(id));
    } catch (e) { errors.push(`${id} : ${e.message}`); }
  }
  return { ok: sent.length > 0, sent, errors };
}

function status() {
  const active = activeCertified();
  return {
    ...config(),
    running: panel.enabled,
    formatPreview: fmt.formatPreview(panel.format, { maxR: panel.maxR }),
    certified: panel.certified.map((c) => ({
      id: c.id, type: c.type, name: c.name, finding: c.finding, motif: c.motif || '',
      rate: c.rate, sample: c.sample, used: c.used || 0, quota: quotaLabel(c),
      tier: tierLabel(c), perfect: isPerfect(c),
      win: c.win, loss: c.loss, certifiedAt: c.certifiedAt,
    })),
    retired: panel.retired.slice(0, 10),
    autoDouble: active.length >= 2,
    activeCount: active.length,
    strategies: strategiesView(),
    globalBilan: bilanOf(panel.predictions),
    sentCount: panel.sentCount,
    lastSentAt: panel.lastSentAt,
    lastScanAt: panel.lastScanAt,
    lastError: panel.lastError,
  };
}

module.exports = {
  panel, status, config, configure, restore, setSender, tick, mirror, test, parseChannels,
  quotaFor, isPerfect, tierLabel, certifyDiscoveries,
};
