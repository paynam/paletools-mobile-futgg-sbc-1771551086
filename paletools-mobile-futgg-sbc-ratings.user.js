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
  const FUTGG_PROXY_URLS = [
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://cors.isomorphic-git.org/${url}`,
  ];
  const CHIP_CLASS = 'pt-futgg-sbc-rating-chip';
  const STATUS_CLASS = 'pt-futgg-sbc-rating-status';
  const LOG_TOGGLE_CLASS = 'pt-futgg-log-toggle';
  const LOG_PANEL_CLASS = 'pt-futgg-log-panel';
  const CARD_FLAG = 'ptFutggRatingBound';

  const state = {
    byName: new Map(),
    loaded: false,
    loading: null,
    lastScanAt: 0,
    statusNode: null,
    lastStatusKey: '',
    logLines: [],
    logPanel: null,
    logPre: null,
    logToggle: null,
  };

  function logLine(message) {
    const ts = new Date().toISOString();
    const line = `${ts} ${message}`;
    state.logLines.push(line);
    if (state.logLines.length > 250) state.logLines.shift();
    console.log(`[PT FUT.GG] ${message}`);
    if (state.logPre) state.logPre.textContent = state.logLines.join('\n');
  }

  function ensureLogUi() {
    if (!document.body) return;
    if (!state.logToggle) {
      const toggle = document.createElement('button');
      toggle.className = LOG_TOGGLE_CLASS;
      toggle.type = 'button';
      toggle.textContent = 'FUT.GG Logs';
      toggle.addEventListener('click', () => {
        if (!state.logPanel) return;
        state.logPanel.classList.toggle('open');
        if (state.logPre) state.logPre.textContent = state.logLines.join('\n');
      });
      document.body.appendChild(toggle);
      state.logToggle = toggle;
    }

    if (!state.logPanel) {
      const panel = document.createElement('div');
      panel.className = LOG_PANEL_CLASS;

      const actions = document.createElement('div');
      actions.className = 'pt-futgg-log-actions';

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.textContent = 'Copy Logs';
      copyBtn.addEventListener('click', async () => {
        const text = state.logLines.join('\n');
        try {
          await navigator.clipboard.writeText(text);
          setStatus('logs copied', 'ok');
        } catch {
          setStatus('clipboard blocked', 'warn');
        }
      });

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.textContent = 'Close';
      closeBtn.addEventListener('click', () => panel.classList.remove('open'));

      const pre = document.createElement('pre');
      pre.className = 'pt-futgg-log-pre';
      pre.textContent = state.logLines.join('\n');

      actions.appendChild(copyBtn);
      actions.appendChild(closeBtn);
      panel.appendChild(actions);
      panel.appendChild(pre);
      document.body.appendChild(panel);
      state.logPanel = panel;
      state.logPre = pre;
    }
  }

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
    logLine(`status:${kind}:${message}`);
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
    logLine('request: GM_xmlhttpRequest start');
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        logLine('request: GM_xmlhttpRequest unavailable');
        reject(new Error('GM_xmlhttpRequest unavailable'));
        return;
      }

      GM_xmlhttpRequest({
        method: 'GET',
        url,
        onload: (response) => {
          try {
            logLine(`request: GM_xmlhttpRequest success (${response.status})`);
            resolve(JSON.parse(response.responseText));
          } catch (err) {
            logLine(`request: parse error ${String(err)}`);
            reject(err);
          }
        },
        onerror: (err) => {
          logLine(`request: GM_xmlhttpRequest error ${String(err)}`);
          reject(err);
        },
        ontimeout: (err) => {
          logLine('request: GM_xmlhttpRequest timeout');
          reject(err);
        },
      });
    });
  }

  async function browserRequest(url) {
    const urls = [url].concat(FUTGG_PROXY_URLS.map((makeProxyUrl) => makeProxyUrl(url)));
    let lastError = null;

    for (const candidate of urls) {
      try {
        logLine(`request: fetch ${candidate}`);
        const response = await fetch(candidate, { credentials: 'omit' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (candidate !== url) setStatus('using CORS proxy', 'warn');
        logLine(`request: fetch success ${candidate}`);
        return payload;
      } catch (err) {
        logLine(`request: fetch failed ${candidate} :: ${String(err)}`);
        lastError = err;
      }
    }

    throw lastError || new Error('All request methods failed');
  }

  function requestJson(url) {
    if (typeof GM_xmlhttpRequest === 'function') return gmRequest(url);
    return browserRequest(url);
  }

  async function ensureData() {
    if (state.loaded) return;
    if (state.loading) return state.loading;

    setStatus('loading ratings...', 'info');
    state.loading = requestJson(FUTGG_SBC_LIST_URL)
      .then((payload) => {
        state.byName = indexSbcs(payload);
        state.loaded = true;
        logLine(`data: indexed entries=${state.byName.size}`);
        if (state.byName.size) {
          setStatus(`ready (${state.byName.size} SBCs)`, 'ok');
        } else {
          setStatus('loaded but no SBC data', 'warn');
        }
      })
      .catch((err) => {
        logLine(`data: load failed ${String(err)}`);
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
      logLine(`match: no match among cards=${cards.length}`);
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
      .${LOG_TOGGLE_CLASS} {
        position: fixed;
        right: 12px;
        bottom: 52px;
        z-index: 2147483647;
        padding: 4px 8px;
        border-radius: 7px;
        border: 1px solid rgba(78, 230, 235, 0.7);
        background: rgba(22, 26, 33, 0.95);
        color: #4ee6eb;
        font-size: 11px;
        font-weight: 700;
      }
      .${LOG_PANEL_CLASS} {
        display: none;
        position: fixed;
        left: 8px;
        right: 8px;
        bottom: 84px;
        max-height: 45vh;
        z-index: 2147483647;
        border: 1px solid rgba(78, 230, 235, 0.7);
        border-radius: 8px;
        background: rgba(12, 15, 20, 0.98);
        color: #d7dde6;
        overflow: hidden;
      }
      .${LOG_PANEL_CLASS}.open { display: block; }
      .pt-futgg-log-actions {
        display: flex;
        gap: 8px;
        padding: 8px;
        border-bottom: 1px solid rgba(78, 230, 235, 0.25);
      }
      .pt-futgg-log-actions button {
        padding: 4px 8px;
        border-radius: 6px;
        border: 1px solid rgba(78, 230, 235, 0.7);
        background: transparent;
        color: #4ee6eb;
        font-size: 11px;
      }
      .pt-futgg-log-pre {
        margin: 0;
        padding: 8px;
        max-height: calc(45vh - 42px);
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 10px;
        line-height: 1.3;
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
    ensureLogUi();
    logLine('init: started');
    await ensureData();
    if (!state.loaded) return;
    logLine('init: observer start');
    bootObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      init().catch((err) => {
        setStatus('init failed', 'error');
        logLine(`init: failed ${String(err)}`);
        console.warn('[PT FUT.GG Ratings] init failed', err);
      });
    });
  } else {
    init().catch((err) => {
      setStatus('init failed', 'error');
      logLine(`init: failed ${String(err)}`);
      console.warn('[PT FUT.GG Ratings] init failed', err);
    });
  }
})();
