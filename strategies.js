// strategies.js — utilitaires partagés (plus AUCUNE stratégie prédéfinie)
//
// Toutes les stratégies codées en dur (Costume par numéro, Dominant Baccarat,
// Match nul, Pair/Impair (VAR), Carte absente, Prédiction dans l'ombre) ont été
// SUPPRIMÉES. Le bot ne fonctionne plus qu'avec les stratégies découvertes par
// l'analyseur IA (« Stratégies IA créées »).
//
// Ce module ne conserve donc que :
//   • les helpers de costume (normalisation, dominance…)
//   • les helpers de séquence VAR (encore utilisés par l'affichage)
//   • un catalogue VIDE (LIST / BY_KEY) pour ne rien casser côté bot / serveur
//   • defaultsFor(key) : réglages communs applicables à n'importe quelle clé
'use strict';

const config = require('./config');

const SUITS = ['♦️', '❤️', '♣️', '♠️'];

// table des inverses (utile aux analyses IA)
const INVERSE = { '❤️': '♣️', '♣️': '❤️', '♦️': '♠️', '♠️': '♦️' };

// normalisation d'un costume : '❤' '♥' '♥️' → '❤️'
function normSuit(s) {
  if (!s) return null;
  const raw = String(s).replace(/\uFE0F/g, '').trim();
  if (raw === '♥' || raw === '❤') return '❤️';
  if (raw === '♦') return '♦️';
  if (raw === '♣') return '♣️';
  if (raw === '♠') return '♠️';
  return null;
}

const suitsOf = (list) => (list || []).map(normSuit).filter(Boolean);

function suitForNumber(n) {
  return normSuit(config.SUIT_BY_LAST_DIGIT[n % 10]) || null;
}

function dominantOf(sixSuits) {
  const count = { '♦️': 0, '❤️': 0, '♣️': 0, '♠️': 0 };
  for (const s of sixSuits) if (count[s] != null) count[s] += 1;
  const values = Object.values(count).sort((a, b) => b - a);
  const max = values[0];
  if (max < 2) return { count, dominant: null, reason: '1-1-1-1 : aucun signal' };
  if (values[1] === max) return { count, dominant: null, reason: `${values.join('-')} : égalité instable` };
  const dominant = Object.keys(count).find((k) => count[k] === max) || null;
  return { count, dominant, reason: `configuration ${values.join('-')} valide` };
}

// ---------------------------------------------------------------------------
// Helpers de séquence (Jeu de départ + VAR) — conservés pour l'affichage
// ---------------------------------------------------------------------------
function normParity(cfg = {}) {
  const c = cfg || {};
  const start = Math.max(1, parseInt(c.startGame, 10) || 1);
  const varN = Math.max(0, parseInt(c.varStep, 10) || 0);
  const dec = Math.max(1, parseInt(c.decalage, 10) || 1);
  return { start, varN, dec };
}

function triggerAt(n, start, varN) {
  if (n < 0) return null;
  return start + 10 * n - (varN >= 1 ? Math.floor(n / varN) : 0);
}

function triggerIndexOf(number, start, varN) {
  if (number < start) return -1;
  let n = 0;
  let guard = 0;
  while (guard++ < 100000) {
    const v = triggerAt(n, start, varN);
    if (v === number) return n;
    if (v > number) return -1;
    n += 1;
  }
  return -1;
}

function lastTriggerAtOrBefore(number, start, varN) {
  if (number < start) return null;
  let n = 0;
  let last = start;
  let guard = 0;
  while (guard++ < 100000) {
    const v = triggerAt(n, start, varN);
    if (v > number) break;
    last = v;
    n += 1;
  }
  return last;
}

function nextTriggerAfter(number, start, varN) {
  const last = lastTriggerAtOrBefore(number, start, varN);
  if (last == null) return start;
  const idx = triggerIndexOf(last, start, varN);
  return triggerAt(idx + 1, start, varN);
}

function triggerSequence(start, varN, count = 12, from = null) {
  const out = [];
  let n = from == null ? 0 : Math.max(0, triggerIndexOf(lastTriggerAtOrBefore(from, start, varN), start, varN));
  for (let i = 0; i < count; i++) out.push(triggerAt(n + i, start, varN));
  return out;
}

function varCounterAt(index, varN) {
  if (varN < 1) return 0;
  return varN - (index % varN);
}

// ---------------------------------------------------------------------------
// Catalogue VIDE : plus aucune stratégie prédéfinie
// ---------------------------------------------------------------------------
const LIST = [];
const BY_KEY = {};

// Réglages communs — renvoyés pour n'importe quelle clé afin que les écrans
// existants continuent de fonctionner sans stratégie prédéfinie.
function defaultsFor(_key) {
  return {
    token: null,
    bilan: true,
    silent: false,
    lossWindow: 3,
    lossTrigger: 2,
    autoUnlockMin: 10,
    resetOnWin: true,
    autoEnabled: false,
    autoTrigger: 'perte',
    autoRattrapage: 2,
    autoSkip: 3,
    autoSend: 1,
    silenceMode: false,
    silenceTrigger: 'perte',
    silenceLossCount: 1,
    silenceRatLevel: 2,
    silenceRatCount: 1,
    silenceOffset: 10,
    silenceCount: 6,
    silenceChannels: [],
    silenceChannelInfos: [],
    publishedChannels: [],
    shadowChannels: [],
    publishedChannelInfos: [],
    shadowChannelInfos: [],
    enabled: false,
    format: config.DEFAULT_FORMAT,
    maxR: config.DEFAULT_MAX_R,
    b: config.DEFAULT_B,
    lead: config.LEAD,
    startGame: 1,
    varStep: 2,
    decalage: 1,
    template: null,
    channels: [],
  };
}

function catalog() {
  return [];
}

module.exports = {
  LIST, BY_KEY, SUITS, INVERSE, normSuit, suitsOf, suitForNumber, dominantOf, defaultsFor, catalog,
  normParity, triggerAt, triggerIndexOf, lastTriggerAtOrBefore, nextTriggerAfter, triggerSequence, varCounterAt,
};
