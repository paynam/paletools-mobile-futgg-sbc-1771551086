// ==UserScript==
// @name         Paletools Mobile - FUT.GG SBC Ratings
// @namespace    https://pale.tools/fifa/
// @version      1.0.0
// @description  Show FUT.GG SBC rating requirements on Companion SBC tiles.
// @author       local
// @match        https://www.ea.com/*/ea-sports-fc/ultimate-team/web-app/*
// @match        https://www.ea.com/ea-sports-fc/ultimate-team/web-app/*
// @grant        GM_xmlhttpRequest
// @connect      fut.gg
// ==/UserScript==

(function () {
  'use strict';

  const FUTGG_SBC_LIST_URL = 'https://www.fut.gg/api/fut/sbc/?no_pagination=true';
  const CHIP_CLASS = 'pt-futgg-sbc-rating-chip';
  const STATUS_CLASS = 'pt-futgg-sbc-rating-status';
  const CARD_FLAG = 'ptFutggRatingBound';

  const state = {
    byName: new Map(),
    loaded: false,
    loading: null,
    lastScanAt: 0,
    statusNode: null,
    lastStatusKey: '',
  };

  function ensureStatusNode() {
    if (state.statusNode && document.body?.contains(state.statusNode)) return state.statusNode;
    if (!document.body) return null;

    const node = document.createElement('div');
    node.className = STATUS_CLASS;
    document.body.appendChild(node);
    state.statusNode = node;
    return node;
  }

  function setStatus(message, kind = 'info') {
    const node = ensureStatusNode();
    if (!node) return;

    const key = `${kind}:${message}`;
    if (state.lastStatusKey === key) return;
    state.lastStatusKey = key;

    node.textContent = `FUT.GG SBC: ${message}`;
    node.dataset.kind = kind;
  }

  function normalize(text) {
    return (text || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function getFromRequirementText(requirementText) {
    const match = /team\s*rating\s*:\s*(\d{2,3})/i.exec(requirementText || '');
    return match ? Number(match[1]) : null;
  }

  function getFromChallengeName(challengeName) {
    const match = /(\d{2,3})\s*[- ]?rated\s*squad/i.exec(challengeName || '');
    return match ? Number(match[1]) : null;
  }

  function formatRatings(set) {
    const ratings = new Set();
    const challenges = Array.isArray(set?.challenges) ? set.challenges : [];

    for (const challenge of challenges) {
      const requirements = Array.isArray(challenge?.requirementsText) ? challenge.requirementsText : [];
      for (const req of requirements) {
        const r = getFromRequirementText(req);
        if (r) ratings.add(r);
      }

      const fromName = getFromChallengeName(challenge?.name);
      if (fromName) ratings.add(fromName);
    }

    const sorted = Array.from(ratings).sort((a, b) => a - b);
    if (!sorted.length) return null;
    return sorted.join('/');
  }

  function indexSbcs(payload) {
    const entries = Array.isArray(payload?.data) ? payload.data : [];
    const byName = new Map();

    for (const set of entries) {
      const key = normalize(set?.name);
      if (!key) continue;
      const ratingLabel = formatRatings(set);
      if (!ratingLabel) continue;

      const item = {
        key,
        name: set.name,
        slug: set.slug,
        ratingLabel,
      };

      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(item);
    }

    return byName;
  }

  function gmRequest(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('GM_xmlhttpRequest is required for cross-origin FUT.GG requests.'));
        return;
      }

      GM_xmlhttpRequest({
        method: 'GET',
        url,
        onload: (response) => {
          try {
            resolve(JSON.parse(response.responseText));
          } catch (err) {
            reject(err);
          }
        },
        onerror: reject,
        ontimeout: reject,
      });
    });
  }

  async function ensureData() {
    if (state.loaded) return;
    if (state.loading) return state.loading;

    setStatus('loading ratings...', 'info');
    state.loading = gmRequest(FUTGG_SBC_LIST_URL)
      .then((payload) => {
        state.byName = indexSbcs(payload);
        state.loaded = true;
        if (state.byName.size) {
          setStatus(`ready (${state.byName.size} SBCs)`, 'ok');
        } else {
          setStatus('loaded but no SBC data', 'warn');
        }
      })
      .catch((err) => {
        setStatus('failed to load ratings', 'error');
        console.warn('[PT FUT.GG Ratings] Failed to load SBC ratings', err);
      })
      .finally(() => {
        state.loading = null;
      });

    return state.loading;
  }

  function findTitleNode(card) {
    const selectors = [
      'h1',
      'h2',
      'h3',
      '.tileTitle',
      '.name',
      '.title',
      '.ut-sbc-set-tile-view--name',
      '.ut-sbc-challenge-tile-view--name',
    ];

    for (const selector of selectors) {
      const node = card.querySelector(selector);
      if (node && node.textContent && node.textContent.trim().length >= 3) {
        return node;
      }
    }

    return null;
  }

  function lookupRatingByTitle(title) {
    const key = normalize(title);
    if (!key) return null;

    const exact = state.byName.get(key);
    if (exact?.length) return exact[0].ratingLabel;

    for (const [candidate, matches] of state.byName.entries()) {
      if (candidate === key) continue;
      if (candidate.includes(key) || key.includes(candidate)) {
        return matches[0].ratingLabel;
      }
    }

    return null;
  }

  function injectChip(targetNode, ratingLabel) {
    if (!targetNode || !ratingLabel) return;

    const existing = targetNode.parentElement?.querySelector(`.${CHIP_CLASS}`);
    if (existing) {
      existing.textContent = `FUT.GG ${ratingLabel}`;
      return;
    }

    const chip = document.createElement('span');
    chip.className = CHIP_CLASS;
    chip.textContent = `FUT.GG ${ratingLabel}`;

    const parent = targetNode.parentElement || targetNode;
    parent.appendChild(chip);
  }

  function processCard(card) {
    if (!card || card[CARD_FLAG]) return false;

    const titleNode = findTitleNode(card);
    if (!titleNode) return false;

    const titleText = titleNode.textContent.trim();
    const ratingLabel = lookupRatingByTitle(titleText);
    if (!ratingLabel) return false;

    injectChip(titleNode, ratingLabel);
    card[CARD_FLAG] = true;
    return true;
  }

  function scanCards() {
    const now = Date.now();
    if (now - state.lastScanAt < 250) return;
    state.lastScanAt = now;

    const selectors = [
      '.ut-sbc-set-tile-view',
      '.ut-sbc-challenge-tile-view',
      '.ut-sbc-challenge-table-row-view',
      '.ut-sbc-challenge-row-view',
      '.ut-sbc-set-view .tile',
    ];

    const cards = document.querySelectorAll(selectors.join(','));
    let matched = 0;

    for (const card of cards) {
      if (processCard(card)) matched += 1;
    }

    if (!state.loaded || !cards.length) return;
    if (matched > 0) {
      setStatus(`matched ${matched} on screen`, 'ok');
    } else {
      setStatus('loaded but no match on this screen', 'warn');
    }
  }

  function ensureStyles() {
    if (document.getElementById('pt-futgg-sbc-rating-style')) return;

    const style = document.createElement('style');
    style.id = 'pt-futgg-sbc-rating-style';
    style.textContent = `
      .${CHIP_CLASS} {
        display: inline-flex;
        margin-left: 6px;
        padding: 1px 6px;
        border-radius: 999px;
        border: 1px solid rgba(78, 230, 235, 0.7);
        color: #4ee6eb;
        font-size: 10px;
        font-weight: 700;
        white-space: nowrap;
        vertical-align: middle;
      }
      .${STATUS_CLASS} {
        position: fixed;
        right: 12px;
        bottom: 12px;
        z-index: 2147483647;
        max-width: 70vw;
        padding: 6px 10px;
        border-radius: 8px;
        border: 1px solid #7f8b99;
        background: rgba(22, 26, 33, 0.95);
        color: #d7dde6;
        font-size: 11px;
        font-weight: 700;
        line-height: 1.25;
      }
      .${STATUS_CLASS}[data-kind="ok"] {
        border-color: rgba(78, 230, 235, 0.8);
        color: #4ee6eb;
      }
      .${STATUS_CLASS}[data-kind="warn"] {
        border-color: rgba(255, 196, 0, 0.85);
        color: #ffd25e;
      }
      .${STATUS_CLASS}[data-kind="error"] {
        border-color: rgba(255, 107, 107, 0.9);
        color: #ff8c8c;
      }
    `;

    document.head.appendChild(style);
  }

  function bootObserver() {
    const observer = new MutationObserver(() => scanCards());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    setInterval(scanCards, 1500);
    scanCards();
  }

  async function init() {
    ensureStyles();
    await ensureData();
    if (!state.loaded) return;
    bootObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      init().catch((err) => {
        setStatus('init failed', 'error');
        console.warn('[PT FUT.GG Ratings] init failed', err);
      });
    });
  } else {
    init().catch((err) => {
      setStatus('init failed', 'error');
      console.warn('[PT FUT.GG Ratings] init failed', err);
    });
  }
})();
