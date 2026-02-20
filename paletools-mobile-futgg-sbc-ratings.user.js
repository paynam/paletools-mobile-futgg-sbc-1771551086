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
  const FUTGG_VOTING_URL = 'https://www.fut.gg/api/voting/entities/?identifiers=';
  const BUILD_ID = 'pt-futgg-20260220-3';
  const REQUEST_TIMEOUT_MS = 10000;
  const REQUEST_HARD_TIMEOUT_MS = 15000;
  const FUTGG_PROXY_URLS = [
    (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    (url) => `https://cors.isomorphic-git.org/${url}`,
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  ];
  const CHIP_CLASS = 'pt-futgg-sbc-rating-chip';
  const CHIP_ANCHOR_CLASS = 'pt-futgg-sbc-card-anchor';
  const STATUS_CLASS = 'pt-futgg-sbc-rating-status';
  const LOG_TOGGLE_CLASS = 'pt-futgg-log-toggle';
  const LOG_PANEL_CLASS = 'pt-futgg-log-panel';
  const DROPDOWN_ITEM_CLASS = 'pt-futgg-sort-item';
  const SORT_DESC_VALUE = '__pt_futgg_desc__';
  const SORT_ASC_VALUE = '__pt_futgg_asc__';
  const CARD_FLAG = 'ptFutggRatingBound';

  const state = {
    byName: new Map(),
    votesById: new Map(),
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

  function scoreFromCard(card) {
    const chip = card?.querySelector?.(`.${CHIP_CLASS}`);
    if (!chip) return -1;
    const txt = (chip.textContent || '').trim();
    const m = /(\d{1,3})\s*%/.exec(txt);
    if (m) return Number(m[1]);
    return -1;
  }

  function sortVisibleSbcCards(sortDescending = true) {
    const selectors = [
      '.ut-sbc-set-tile-view',
      '.ut-sbc-challenge-tile-view',
      '.ut-sbc-challenge-table-row-view',
      '.ut-sbc-challenge-row-view',
      '.ut-sbc-set-view .tile',
    ];
    const cards = Array.from(document.querySelectorAll(selectors.join(',')));
    const groups = new Map();

    for (const card of cards) {
      const parent = card.parentElement;
      if (!parent) continue;
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(card);
    }

    let moved = 0;
    for (const [parent, group] of groups.entries()) {
      if (group.length < 2) continue;
      const sorted = group
        .slice()
        .sort((a, b) => {
          const sa = scoreFromCard(a);
          const sb = scoreFromCard(b);
          return sortDescending ? sb - sa : sa - sb;
        });

      for (const card of sorted) {
        parent.appendChild(card);
        moved += 1;
      }
    }

    const dir = sortDescending ? 'desc' : 'asc';
    setStatus(`sorted by FUT.GG ${dir}`, 'ok');
    logLine(`sort: applied direction=${dir} moved=${moved}`);
  }

  function ensureSelectSortHook() {
    const selects = Array.from(document.querySelectorAll('select'));
    for (const select of selects) {
      if (select.dataset.ptFutggSortHooked === '1') continue;
      const identity = `${select.id} ${select.name} ${select.className}`.toLowerCase();
      if (!identity.includes('sort')) continue;

      if (!Array.from(select.options).some((o) => o.value === SORT_DESC_VALUE)) {
        const descOpt = document.createElement('option');
        descOpt.value = SORT_DESC_VALUE;
        descOpt.textContent = 'FUT.GG Rating (High to Low)';
        select.appendChild(descOpt);
      }
      if (!Array.from(select.options).some((o) => o.value === SORT_ASC_VALUE)) {
        const ascOpt = document.createElement('option');
        ascOpt.value = SORT_ASC_VALUE;
        ascOpt.textContent = 'FUT.GG Rating (Low to High)';
        select.appendChild(ascOpt);
      }

      select.addEventListener('change', () => {
        if (select.value === SORT_DESC_VALUE) sortVisibleSbcCards(true);
        if (select.value === SORT_ASC_VALUE) sortVisibleSbcCards(false);
      });
      select.dataset.ptFutggSortHooked = '1';
      logLine('sort: hooked native select sort dropdown');
    }
  }

  function ensureListSortHook() {
    const containers = Array.from(
      document.querySelectorAll('.ut-drop-down-view, .ut-drop-down-pop-up, .ut-context-menu, .ut-pop-up-view, .ui-dialog')
    );

    for (const container of containers) {
      const text = (container.textContent || '').toLowerCase();
      if (!text.includes('sort')) continue;
      if (container.querySelector(`.${DROPDOWN_ITEM_CLASS}`)) continue;

      const host = container.querySelector('.itemList, ul, .list, .ut-list-view, .ut-button-group') || container;

      const descBtn = document.createElement('button');
      descBtn.type = 'button';
      descBtn.className = DROPDOWN_ITEM_CLASS;
      descBtn.textContent = 'FUT.GG Rating (High to Low)';
      descBtn.addEventListener('click', () => sortVisibleSbcCards(true));

      const ascBtn = document.createElement('button');
      ascBtn.type = 'button';
      ascBtn.className = DROPDOWN_ITEM_CLASS;
      ascBtn.textContent = 'FUT.GG Rating (Low to High)';
      ascBtn.addEventListener('click', () => sortVisibleSbcCards(false));

      host.appendChild(descBtn);
      host.appendChild(ascBtn);
      logLine('sort: injected FUT.GG options into sort dropdown list');
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
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/&/g, ' and ')
      .replace(/\b(sbc|challenge|group)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function tokenSet(text) {
    return new Set(normalize(text).split(' ').filter((t) => t.length >= 2));
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

      const item = {
        key,
        id: set.id,
        name: set.name,
        slug: set.slug,
        ratingLabel,
      };

      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(item);
    }

    return byName;
  }

  async function loadVotesForSbcs(payload) {
    const entries = Array.isArray(payload?.data) ? payload.data : [];
    const ids = entries
      .map((s) => s?.id)
      .filter((id) => Number.isFinite(id))
      .map((id) => Number(id));
    if (!ids.length) return;

    const chunkSize = 40;
    const voteMap = new Map();

    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const identifiers = chunk.map((id) => `20_${id}`).join(',');
      const payloadChunk = await requestJson(`${FUTGG_VOTING_URL}${encodeURIComponent(identifiers)}`);
      const data = Array.isArray(payloadChunk?.data) ? payloadChunk.data : [];

      for (const row of data) {
        const key = String(row?.entityIdentifier || '');
        const m = /^20_(\d+)$/.exec(key);
        if (!m) continue;
        const id = Number(m[1]);
        const up = Number(row?.upvotes || 0);
        const down = Number(row?.downvotes || 0);
        const total = Number(row?.totalVotes || up + down || 0);
        const upPct = total > 0 ? Math.round((up * 100) / total) : null;
        voteMap.set(id, { up, down, total, upPct });
      }
    }

    state.votesById = voteMap;
    logLine(`votes: loaded entries=${voteMap.size}`);
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
        timeout: REQUEST_TIMEOUT_MS,
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
        const controller = new AbortController();
        let timer = null;
        const fetchPromise = fetch(candidate, {
          credentials: 'omit',
          signal: controller.signal,
        });
        const timeoutPromise = new Promise((_, reject) => {
          timer = setTimeout(() => {
            try {
              controller.abort();
            } catch {}
            reject(new Error(`Timeout after ${REQUEST_TIMEOUT_MS}ms`));
          }, REQUEST_TIMEOUT_MS);
        });
        const response = await Promise.race([fetchPromise, timeoutPromise]);
        clearTimeout(timer);
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

  function withHardTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      promise
        .then((v) => {
          clearTimeout(timer);
          resolve(v);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  async function ensureData() {
    if (state.loaded) return;
    if (state.loading) return state.loading;

    setStatus('loading ratings...', 'info');
    state.loading = withHardTimeout(requestJson(FUTGG_SBC_LIST_URL), REQUEST_HARD_TIMEOUT_MS, 'SBC list request')
      .then((payload) => {
        state.byName = indexSbcs(payload);
        return withHardTimeout(loadVotesForSbcs(payload), REQUEST_HARD_TIMEOUT_MS, 'Voting request')
          .catch((err) => {
            logLine(`votes: load failed ${String(err)}`);
          })
          .finally(() => {
            state.loaded = true;
            logLine(`data: indexed entries=${state.byName.size}`);
            if (state.byName.size) {
              setStatus(`ready (${state.byName.size} SBCs)`, 'ok');
            } else {
              setStatus('loaded but no SBC data', 'warn');
            }
          });
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

  function lookupSbcByTitle(title) {
    const key = normalize(title);
    if (!key) return null;

    const exact = state.byName.get(key);
    if (exact?.length) return exact[0];

    const keyTokens = tokenSet(key);
    let best = null;
    let bestScore = 0;

    for (const [candidate, matches] of state.byName.entries()) {
      if (candidate === key) continue;
      if (candidate.includes(key) || key.includes(candidate)) {
        return matches[0];
      }

      const candidateTokens = tokenSet(candidate);
      if (!candidateTokens.size || !keyTokens.size) continue;

      let common = 0;
      for (const token of keyTokens) {
        if (candidateTokens.has(token)) common += 1;
      }

      const denom = Math.max(keyTokens.size, candidateTokens.size);
      const score = denom ? common / denom : 0;
      if (common >= 2 && score > bestScore) {
        best = matches[0];
        bestScore = score;
      }
    }

    return bestScore >= 0.5 ? best : null;
  }

  function formatVoteLabel(sbc) {
    const vote = state.votesById.get(Number(sbc?.id));
    if (!vote || vote.upPct == null) return null;
    return `${vote.upPct}%`;
  }

  function injectChip(card, sbc) {
    if (!card || !sbc) return;
    const voteLabel = formatVoteLabel(sbc);
    const fallback = sbc.ratingLabel ? `REQ ${sbc.ratingLabel}` : null;
    const text = voteLabel ? `FUT.GG ${voteLabel}` : fallback ? `FUT.GG ${fallback}` : null;
    if (!text) return;

    const existing = card.querySelector(`.${CHIP_CLASS}`);
    if (existing) {
      existing.textContent = text;
      return;
    }

    card.classList.add(CHIP_ANCHOR_CLASS);
    const chip = document.createElement('span');
    chip.className = CHIP_CLASS;
    chip.textContent = text;
    card.appendChild(chip);
  }

  function processCard(card) {
    if (!card || card[CARD_FLAG]) return false;

    const titleNode = findTitleNode(card);
    if (!titleNode) return false;

    const titleText = titleNode.textContent.trim();
    const sbc = lookupSbcByTitle(titleText);
    if (!sbc) return false;

    injectChip(card, sbc);
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
    let visibleWithChip = 0;

    for (const card of cards) {
      if (card.querySelector(`.${CHIP_CLASS}`)) visibleWithChip += 1;
      if (processCard(card)) matched += 1;
    }

    if (!state.loaded || !cards.length) return;
    const totalMatched = visibleWithChip + matched;
    if (totalMatched > 0) {
      setStatus(`matched ${totalMatched} on screen`, 'ok');
    } else {
      setStatus('loaded but no match on this screen', 'warn');
      logLine(`match: no match among cards=${cards.length}`);
    }

    ensureSelectSortHook();
    ensureListSortHook();
  }

  function ensureStyles() {
    if (document.getElementById('pt-futgg-sbc-rating-style')) return;

    const style = document.createElement('style');
    style.id = 'pt-futgg-sbc-rating-style';
    style.textContent = `
      .${CHIP_CLASS} {
        position: absolute;
        right: 6px;
        bottom: 6px;
        z-index: 2;
        display: inline-flex;
        padding: 2px 6px;
        border-radius: 999px;
        border: 1px solid rgba(78, 230, 235, 0.7);
        background: rgba(12, 15, 20, 0.92);
        color: #4ee6eb;
        font-size: 10px;
        font-weight: 700;
        white-space: nowrap;
      }
      .${CHIP_ANCHOR_CLASS} {
        position: relative !important;
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
      .${DROPDOWN_ITEM_CLASS} {
        width: 100%;
        margin-top: 6px;
        padding: 8px 10px;
        border-radius: 6px;
        border: 1px solid rgba(78, 230, 235, 0.7);
        background: rgba(22, 26, 33, 0.95);
        color: #4ee6eb;
        text-align: left;
        font-size: 12px;
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
    logLine(`build: ${BUILD_ID}`);
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
