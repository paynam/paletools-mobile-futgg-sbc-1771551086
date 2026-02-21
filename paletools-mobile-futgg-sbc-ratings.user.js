// ==UserScript==
// @name         Paletools Mobile - FUT.GG SBC Ratings
// @namespace    https://pale.tools/fifa/
// @version      1.1.0
// @description  Show FUT.GG SBC ratings and player details ratings in Companion.
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
  const BUILD_ID = 'pt-futgg-20260221-21';
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
  const PLAYER_MENU_ITEM_CLASS = 'pt-futgg-player-menu-item';
  const SETTINGS_LOG_ITEM_CLASS = 'pt-futgg-settings-log-item';
  const LOG_PANEL_CLASS = 'pt-futgg-log-panel';
  const DROPDOWN_ITEM_CLASS = 'pt-futgg-sort-item';
  const SORT_DESC_VALUE = '__pt_futgg_desc__';
  const SORT_ASC_VALUE = '__pt_futgg_asc__';
  const CARD_FLAG = 'ptFutggRatingBound';
  const PLAYER_CONTENT_TYPE = 27;
  const DEFAULT_GAME = '26';

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
    playerMenuNode: null,
    playerCache: new Map(),
    chemStyleNamesByGame: new Map(),
    chemStyleNamesLoadByGame: new Map(),
    lastPlayerScanAt: 0,
    recentPlayerIds: [],
    networkSnifferInstalled: false,
    lastPlayerDebugKey: '',
    lastControllerLogKey: '',
    lastRejectLogKey: '',
    lastControllerRootsLogKey: '',
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
          logLine('status:ok:logs copied');
        } catch {
          logLine('status:warn:clipboard blocked');
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

  function openLogsPanel() {
    ensureLogUi();
    if (!state.logPanel) return;
    state.logPanel.classList.add('open');
    if (state.logPre) state.logPre.textContent = state.logLines.join('\n');
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

  function ensureSettingsLogsHook() {
    const containers = Array.from(
      document.querySelectorAll(
        '.ut-drop-down-view, .ut-drop-down-pop-up, .ut-context-menu, .ut-pop-up-view, .ui-dialog, .ut-menu-view'
      )
    );
    for (const container of containers) {
      const text = (container.textContent || '').toLowerCase();
      if (!text.includes('setting') && !text.includes('paletools')) continue;
      if (container.querySelector(`.${SETTINGS_LOG_ITEM_CLASS}`)) continue;

      const host = container.querySelector('.itemList, ul, .list, .ut-list-view, .ut-button-group') || container;
      const rowTemplate =
        host.querySelector('button, .listFUTItem, li, .ut-list-row-view, .ut-list-item-view, .row, .ut-clickable') || null;

      let item;
      if (rowTemplate) {
        item = rowTemplate.cloneNode(true);
        item.classList.add(SETTINGS_LOG_ITEM_CLASS);
        item.removeAttribute?.('id');
        item.querySelectorAll?.('[id]')?.forEach((n) => n.removeAttribute('id'));
        setPrimaryText(item, 'FUT.GG Logs');
      } else {
        item = document.createElement('button');
        item.type = 'button';
        item.className = `${DROPDOWN_ITEM_CLASS} ${SETTINGS_LOG_ITEM_CLASS}`;
        item.textContent = 'FUT.GG Logs';
      }

      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openLogsPanel();
      });
      host.appendChild(item);
      logLine('logs: injected FUT.GG Logs item into settings menu');
    }
  }

  function setPrimaryText(node, text) {
    const selectors = ['.label', '.title', '.name', '.btn-text', 'span', 'div'];
    for (const selector of selectors) {
      const target = node.querySelector(selector);
      if (!target) continue;
      if ((target.textContent || '').trim().length < 1) continue;
      target.textContent = text;
      return;
    }
    node.textContent = text;
  }

  function setRowLabelStrict(node, text) {
    const targets = node.querySelectorAll('.label, .title, .name, .btn-text, span, div');
    let replaced = false;
    for (const t of targets) {
      if (!t || t.children.length > 0) continue;
      const cur = (t.textContent || '').trim();
      if (!cur) continue;
      t.textContent = text;
      replaced = true;
      break;
    }
    if (!replaced) setPrimaryText(node, text);
  }

  function ensurePaletoolsSettingsLogsHook() {
    let titleNode = document.querySelector('[id^="plugin-title-"], [class*="plugin-title-"]');
    if (!titleNode) {
      const candidates = Array.from(
        document.querySelectorAll('button, .listFUTItem, li, .ut-list-row-view, .ut-list-item-view, .ut-clickable, [role="button"]')
      );
      titleNode =
        candidates.find((n) => {
          const t = (n.textContent || '').toLowerCase();
          return t.includes('paletools');
        }) || null;
    }
    if (!titleNode) return;

    const rowTemplate =
      titleNode.closest('button, .listFUTItem, li, .ut-list-row-view, .ut-list-item-view, .row, .ut-clickable') || titleNode;
    const host = rowTemplate.parentElement || titleNode.parentElement;
    if (!host) return;
    if (host.querySelector(`.${SETTINGS_LOG_ITEM_CLASS}`)) return;

    const item = rowTemplate.cloneNode(true);
    item.classList.add(SETTINGS_LOG_ITEM_CLASS);
    item.removeAttribute?.('id');
    item.querySelectorAll?.('[id]')?.forEach((n) => n.removeAttribute('id'));
    setRowLabelStrict(item, 'FUT.GG Logs');
    const onOpenLogs = (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
      openLogsPanel();
    };
    item.addEventListener('click', onOpenLogs, true);
    item.addEventListener('touchend', onOpenLogs, true);
    item.addEventListener('pointerup', onOpenLogs, true);

    if (rowTemplate.parentNode) {
      rowTemplate.parentNode.insertBefore(item, rowTemplate.nextSibling);
    } else {
      host.appendChild(item);
    }
    logLine('logs: injected FUT.GG Logs item by cloning Paletools row');
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
    logLine(`status:${kind}:${message}`);

    if (kind !== 'error') {
      if (state.statusNode) state.statusNode.style.display = 'none';
      return;
    }

    const node = ensureStatusNode();
    if (!node) return;
    const key = `${kind}:${message}`;
    if (state.lastStatusKey === key) return;
    state.lastStatusKey = key;

    node.style.display = 'block';
    node.textContent = `FUT.GG SBC: ${message}`;
    node.dataset.kind = kind;
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

  function toTitle(text) {
    return String(text || '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b[a-z]/g, (c) => c.toUpperCase());
  }

  function formatCoins(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return null;
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return `${Math.round(num)}`;
  }

  function isVisible(node) {
    if (!node || typeof node.getBoundingClientRect !== 'function') return false;
    const rect = node.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return false;
    const style = window.getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function parseGameEaIdFromText(text) {
    const match = /(?:^|\/|[^0-9])(\d{2})-(\d{5,10})(?:\/|$|[^0-9])/i.exec(text || '');
    if (!match) return null;
    return { game: match[1], eaId: Number(match[2]) };
  }

  function addRecentPlayerId(eaId, source) {
    if (!Number.isFinite(eaId) || eaId < 100000) return;
    const existing = state.recentPlayerIds.find((x) => x.eaId === eaId);
    if (existing) {
      existing.ts = Date.now();
      existing.source = source;
    } else {
      state.recentPlayerIds.push({ eaId, source, ts: Date.now() });
    }
    state.recentPlayerIds.sort((a, b) => b.ts - a.ts);
    if (state.recentPlayerIds.length > 30) state.recentPlayerIds.length = 30;
  }

  function extractEaIdsFromText(text) {
    const out = [];
    const re = /\b(\d{6,9})\b/g;
    let m;
    while ((m = re.exec(text || ''))) {
      const id = Number(m[1]);
      if (Number.isFinite(id) && id >= 100000) out.push(id);
    }
    return out;
  }

  function extractEaIdsFromJsonLike(value, max = 12) {
    const out = [];
    const seen = new WeakSet();
    const queue = [value];
    while (queue.length && out.length < max) {
      const cur = queue.shift();
      if (!cur || typeof cur !== 'object') continue;
      if (seen.has(cur)) continue;
      seen.add(cur);

      const id = pickEaIdFromObject(cur);
      if (id && !out.includes(id)) out.push(id);

      if (Array.isArray(cur)) {
        const lim = Math.min(cur.length, 20);
        for (let i = 0; i < lim; i++) {
          const child = cur[i];
          if (child && typeof child === 'object') queue.push(child);
        }
        continue;
      }

      const keys = Object.keys(cur);
      for (const key of keys) {
        if (!key || key.startsWith('__')) continue;
        const child = cur[key];
        if (child && typeof child === 'object') queue.push(child);
      }
    }
    return out;
  }

  function installNetworkSniffer() {
    if (state.networkSnifferInstalled) return;
    state.networkSnifferInstalled = true;

    try {
      const originalFetch = window.fetch;
      if (typeof originalFetch === 'function') {
        window.fetch = function (...args) {
          let url = '';
          const isOwnFutggTraffic = (u) =>
            /fut\.gg|api\.codetabs\.com|corsproxy\.io|allorigins\.win|isomorphic-git\.org/i.test(String(u || ''));
          try {
            url = String(args?.[0]?.url || args?.[0] || '');
            if (!isOwnFutggTraffic(url)) {
              const ids = extractEaIdsFromText(url);
              for (const id of ids) addRecentPlayerId(id, 'fetch');
            }
          } catch {}
          const p = originalFetch.apply(this, args);
          try {
            Promise.resolve(p)
              .then((resp) => {
                try {
                  if (isOwnFutggTraffic(url)) return;
                  if (!resp || typeof resp.clone !== 'function') return;
                  const ct = String(resp.headers?.get?.('content-type') || '');
                  if (/json/i.test(ct)) {
                    return resp
                      .clone()
                      .json()
                      .then((body) => {
                        const ids = extractEaIdsFromJsonLike(body);
                        for (const id of ids) addRecentPlayerId(id, 'fetch-body');
                      })
                      .catch(() => {});
                  }
                  return resp
                    .clone()
                    .text()
                    .then((text) => {
                      const t = String(text || '').trim();
                      if (!t || t.length > 500000) return;
                      if (!(t.startsWith('{') || t.startsWith('['))) return;
                      const body = JSON.parse(t);
                      const ids = extractEaIdsFromJsonLike(body);
                      for (const id of ids) addRecentPlayerId(id, 'fetch-body');
                    })
                    .catch(() => {});
                } catch {}
              })
              .catch(() => {});
          } catch {}
          return p;
        };
      }
    } catch (err) {
      logLine(`player: fetch sniffer install failed ${String(err)}`);
    }

    try {
      const originalOpen = XMLHttpRequest.prototype.open;
      const originalSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        try {
          this.__ptFutggUrl = String(url || '');
          if (!/fut\.gg|api\.codetabs\.com|corsproxy\.io|allorigins\.win|isomorphic-git\.org/i.test(this.__ptFutggUrl)) {
            const ids = extractEaIdsFromText(String(url || ''));
            for (const id of ids) addRecentPlayerId(id, 'xhr');
          }
        } catch {}
        return originalOpen.call(this, method, url, ...rest);
      };
      XMLHttpRequest.prototype.send = function (...args) {
        try {
          this.addEventListener('load', () => {
            try {
              if (/fut\.gg|api\.codetabs\.com|corsproxy\.io|allorigins\.win|isomorphic-git\.org/i.test(this.__ptFutggUrl || '')) return;
              const ct = String(this.getResponseHeader?.('content-type') || '');
              const text = String(this.responseText || '');
              if (!text || text.length > 500000) return;
              if (!/json/i.test(ct)) {
                const t = text.trim();
                if (!(t.startsWith('{') || t.startsWith('['))) return;
              }
              const body = JSON.parse(text);
              const ids = extractEaIdsFromJsonLike(body);
              for (const id of ids) addRecentPlayerId(id, 'xhr-body');
            } catch {}
          });
        } catch {}
        return originalSend.call(this, ...args);
      };
    } catch (err) {
      logLine(`player: xhr sniffer install failed ${String(err)}`);
    }

    logLine('player: network sniffer installed');
  }

  function getValueAtPath(obj, path) {
    let cur = obj;
    for (const key of path) {
      if (!cur || typeof cur !== 'object' || !(key in cur)) return undefined;
      cur = cur[key];
    }
    return cur;
  }

  function pickEaIdFromObject(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const candidates = [
      obj.definitionId,
      obj._definitionId,
      obj.resourceId,
      obj._resourceId,
      obj.eaId,
      obj._eaId,
      obj.id,
      obj._id,
    ]
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n) && n >= 10000);
    return candidates.length ? candidates[0] : null;
  }

  function pickPlayerNameFromObject(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const first = String(obj.firstName || obj.cleanedFirstName || '').trim();
    const last = String(obj.lastName || obj.cleanedLastName || '').trim();
    const common = String(obj.commonName || obj.cleanedCommonName || '').trim();
    const full =
      [first, last].filter(Boolean).join(' ') ||
      common ||
      String(obj.name || obj.displayName || obj.playerName || '').trim();
    return full || null;
  }

  function getDisplayedPlayerName(detailRoot) {
    if (!detailRoot) return null;
    const selectors = [
      '.entityContainer .name',
      '.firstname',
      '.lastname',
      '.name',
      '.title',
      'h1',
      'h2',
      '[class*="playerName"]',
      '[class*="itemName"]',
      '[class*="bio"] .name',
    ];
    for (const selector of selectors) {
      const node = detailRoot.querySelector(selector);
      const txt = String(node?.textContent || '').trim();
      if (txt.length >= 3) return txt;
    }
    return null;
  }

  function nameSimilarityScore(a, b) {
    const ta = tokenSet(a || '');
    const tb = tokenSet(b || '');
    if (!ta.size || !tb.size) return 0;
    let common = 0;
    for (const t of ta) if (tb.has(t)) common += 1;
    const denom = Math.max(ta.size, tb.size);
    return denom ? common / denom : 0;
  }

  function getControllerRoots() {
    const roots = [];
    const addRoot = (node, source) => {
      if (!node || typeof node !== 'object') return;
      roots.push({ node, source });
    };
    try {
      const app = typeof getAppMain === 'function' ? getAppMain() : null;
      if (app) {
        addRoot(app, 'app');
        try {
          const rootVc = typeof app.getRootViewController === 'function' ? app.getRootViewController() : null;
          if (rootVc) addRoot(rootVc, 'rootVc');
          const presented = typeof rootVc?.getPresentedViewController === 'function' ? rootVc.getPresentedViewController() : null;
          if (presented) addRoot(presented, 'rootVc.presented');
        } catch {}
        try {
          const current = typeof app.getCurrentController === 'function' ? app.getCurrentController() : null;
          if (current) addRoot(current, 'app.currentController');
        } catch {}
      }
    } catch {}

    const controllerLinkKeys = [
      'childViewControllers',
      '_childViewControllers',
      'presentedViewController',
      '_presentedViewController',
      'navigationController',
      '_navigationController',
      'viewControllers',
      '_viewControllers',
      '_currentController',
      'currentController',
      'presentationController',
      '_presentationController',
    ];

    const seen = new WeakSet();
    const queue = roots.slice(0);
    let visited = 0;
    const MAX_VISIT = 220;
    while (queue.length && visited < MAX_VISIT) {
      const cur = queue.shift();
      const node = cur?.node;
      if (!node || typeof node !== 'object') continue;
      if (seen.has(node)) continue;
      seen.add(node);
      visited += 1;
      for (const key of controllerLinkKeys) {
        const val = node[key];
        if (!val || typeof val !== 'object') continue;
        if (Array.isArray(val)) {
          const lim = Math.min(val.length, 20);
          for (let i = 0; i < lim; i++) {
            const child = val[i];
            if (child && typeof child === 'object') {
              const source = `${cur.source}.${key}[${i}]`;
              addRoot(child, source);
              queue.push({ node: child, source });
            }
          }
        } else {
          const source = `${cur.source}.${key}`;
          addRoot(val, source);
          queue.push({ node: val, source });
        }
      }
    }

    const uniq = [];
    const seen2 = new WeakSet();
    for (const r of roots) {
      if (!r?.node || typeof r.node !== 'object') continue;
      if (seen2.has(r.node)) continue;
      seen2.add(r.node);
      uniq.push(r);
    }
    const rootsLogKey = String(uniq.length);
    if (state.lastControllerRootsLogKey !== rootsLogKey) {
      state.lastControllerRootsLogKey = rootsLogKey;
      logLine(`player: controller roots=${uniq.length}`);
    }
    return uniq;
  }

  function resolvePlayerContextFromController(detailRoot) {
    const roots = getControllerRoots();
    const displayedName = getDisplayedPlayerName(detailRoot);
    const itemPaths = [
      ['presentedItem'],
      ['_presentedItem'],
      ['item'],
      ['_item'],
      ['itemData'],
      ['_itemData'],
      ['_itemDetailController', 'item'],
      ['_itemDetailController', '_item'],
      ['_itemDetailsController', 'item'],
      ['_itemDetailsController', '_item'],
      ['itemDetailController', 'item'],
      ['itemDetailController', '_item'],
      ['_viewmodel', 'item'],
      ['_viewmodel', '_item'],
      ['_viewmodel', 'itemData'],
      ['_viewmodel', '_itemData'],
    ];

    const candidates = [];
    const badPathRe =
      /(hubmessages|message|tile|store|pack|objective|transfer|market|sbc|navigation|tabbar|gameflow|news|banner|inbox)/i;
    const detailLikePathRe = /(itemdetail|itemdetails|presenteditem|currentitem|itemdata|detail|playerbio|bio)/i;

    for (const rootWrap of roots) {
      const root = rootWrap?.node;
      if (!root || typeof root !== 'object') continue;
      for (const path of itemPaths) {
        const item = getValueAtPath(root, path);
        const eaId = pickEaIdFromObject(item);
        if (!eaId) continue;
        const playerName = pickPlayerNameFromObject(item);
        let score = 100;
        if (playerName) score += 20;
        if (displayedName && playerName) score += Math.round(100 * nameSimilarityScore(displayedName, playerName));
        candidates.push({
          game: DEFAULT_GAME,
          eaId,
          playerName: playerName || null,
          score,
          source: `controller:${rootWrap.source}.${path.join('.')}`,
        });
      }

      const eaIdDirect = pickEaIdFromObject(root);
      if (eaIdDirect) {
        const directName = pickPlayerNameFromObject(root);
        let score = 60;
        if (directName) score += 20;
        if (displayedName && directName) score += Math.round(100 * nameSimilarityScore(displayedName, directName));
        candidates.push({
          game: DEFAULT_GAME,
          eaId: eaIdDirect,
          playerName: directName || null,
          score,
          source: `controller:${rootWrap.source}.direct`,
        });
      }

      const seen = new WeakSet();
      const queue = [{ node: root, path: rootWrap.source, depth: 0 }];
      let visited = 0;
      const MAX_VISIT = 800;
      const MAX_DEPTH = 5;
      while (queue.length && visited < MAX_VISIT) {
        const cur = queue.shift();
        const node = cur?.node;
        const depth = cur?.depth || 0;
        if (!node || typeof node !== 'object') continue;
        if (seen.has(node)) continue;
        seen.add(node);
        visited += 1;

        const eaId = pickEaIdFromObject(node);
        if (eaId) {
          const nodeName = pickPlayerNameFromObject(node);
          let score = 20;
          if (nodeName) score += 20;
          if (displayedName && nodeName) score += Math.round(100 * nameSimilarityScore(displayedName, nodeName));
          if (Number(node?.rating) > 0) score += 5;
          if (Number(node?.skillMoves) > 0) score += 5;
          if (Number(node?.weakFoot) > 0) score += 5;
          candidates.push({
            game: DEFAULT_GAME,
            eaId,
            playerName: nodeName || null,
            score,
            source: `controller:deep.${cur.path}`,
          });
        }

        if (depth >= MAX_DEPTH) continue;
        const keys = Object.keys(node);
        for (const key of keys) {
          if (!key) continue;
          if (key.startsWith('__')) continue;
          const val = node[key];
          if (!val || typeof val !== 'object') continue;
          if (Array.isArray(val)) {
            const lim = Math.min(val.length, 8);
            for (let i = 0; i < lim; i++) {
              const child = val[i];
              if (child && typeof child === 'object') queue.push({ node: child, path: `${cur.path}.${key}[${i}]`, depth: depth + 1 });
            }
          } else {
            queue.push({ node: val, path: `${cur.path}.${key}`, depth: depth + 1 });
          }
        }
      }
    }

    if (!candidates.length) return null;
    const filtered = candidates.filter((c) => {
      const source = c.source || '';
      if (badPathRe.test(source) && !detailLikePathRe.test(source)) return false;
      const sim = displayedName && c.playerName ? nameSimilarityScore(displayedName, c.playerName) : 0;
      if (sim >= 0.6) return true;
      if (detailLikePathRe.test(source) && c.score >= 95) return true;
      if (!displayedName && detailLikePathRe.test(source) && c.score >= 105) return true;
      return false;
    });
    if (!filtered.length) {
      logLine(`player: controller candidates rejected total=${candidates.length} displayedName=${displayedName || 'n/a'}`);
      return null;
    }
    filtered.sort((a, b) => b.score - a.score);
    const best = filtered[0];
    const logKey = `${best.game}-${best.eaId}:${best.source}:${best.score}:${best.playerName || ''}:${filtered.length}/${candidates.length}`;
    if (state.lastControllerLogKey !== logKey) {
      state.lastControllerLogKey = logKey;
      logLine(
        `player: controller candidates=${filtered.length}/${candidates.length} best=${best.game}-${best.eaId} score=${best.score} source=${
          best.source
        } name=${best.playerName || 'n/a'}`
      );
    }
    return best;
  }

  function resolvePlayerContextFromRecent(detailRoot) {
    if (!Array.isArray(state.recentPlayerIds) || !state.recentPlayerIds.length) return null;
    const now = Date.now();
    const fresh = state.recentPlayerIds.filter((x) => now - Number(x.ts || 0) < 15000).slice(0, 12);
    if (!fresh.length) return null;

    const score = (row) => {
      const src = String(row?.source || '');
      let s = 0;
      if (src.includes('body')) s += 100;
      if (src.includes('fetch')) s += 20;
      if (src.includes('xhr')) s += 15;
      const age = now - Number(row?.ts || now);
      s += Math.max(0, 10000 - age) / 200;
      return s;
    };

    fresh.sort((a, b) => score(b) - score(a));
    const best = fresh[0];
    if (Number(best?.eaId) >= 10000) {
      return { game: DEFAULT_GAME, eaId: best.eaId, source: `recent:${best.source}` };
    }
    return null;
  }

  function extractInternalObjectsFromNode(node) {
    if (!node || typeof node !== 'object') return [];
    const out = [];
    const keys = Object.getOwnPropertyNames(node);
    let genericAdded = 0;
    for (const key of keys) {
      if (!key) continue;
      const val = node[key];
      if (!val || typeof val !== 'object') continue;
      if (
        key.startsWith('__reactProps$') ||
        key.startsWith('__reactFiber$') ||
        key.startsWith('__reactContainer$') ||
        key === '_viewmodel' ||
        key === '_currentController' ||
        key === 'controller' ||
        key === 'viewmodel' ||
        key === '_item' ||
        key === 'item' ||
        key === '_player' ||
        key === 'player' ||
        key === '_currentItem' ||
        key === 'currentItem' ||
        key === 'itemData'
      ) {
        out.push({ obj: val, key });
        continue;
      }
      if ((key.startsWith('_') || key.toLowerCase().includes('item') || key.toLowerCase().includes('player')) && genericAdded < 20) {
        out.push({ obj: val, key });
        genericAdded += 1;
      }
    }
    return out;
  }

  function resolvePlayerContextFromUiInternals(detailRoot, hostInfo) {
    const displayedName = getDisplayedPlayerName(detailRoot);
    const seedNodes = [
      { node: detailRoot, label: 'detailRoot' },
      { node: hostInfo?.host, label: 'menuHost' },
      { node: hostInfo?.templateNode, label: 'menuTemplate' },
      { node: hostInfo?.host?.parentElement, label: 'menuHostParent' },
      { node: document.querySelector('.ut-item-details-view, .itemDetailView, .DetailPanel, .ut-player-bio-view'), label: 'detailsNode' },
    ].filter((x) => x.node);

    const badPathRe = /(hubmessages|message|tile|store|pack|objective|transfer|market|sbc|navigation|tabbar|news|banner|inbox)/i;
    const goodPathRe = /(item|player|detail|bio|viewmodel|controller|entity|presented|current|selected|active)/i;
    const candidates = [];

    for (const seed of seedNodes) {
      const internals = extractInternalObjectsFromNode(seed.node);
      for (const internal of internals) {
        const seen = new WeakSet();
        const queue = [{ node: internal.obj, path: `${seed.label}.${internal.key}`, depth: 0 }];
        let visited = 0;
        const MAX_VISIT = 500;
        const MAX_DEPTH = 5;
        while (queue.length && visited < MAX_VISIT) {
          const cur = queue.shift();
          const obj = cur?.node;
          const depth = cur?.depth || 0;
          if (!obj || typeof obj !== 'object') continue;
          if (seen.has(obj)) continue;
          seen.add(obj);
          visited += 1;

          const eaId = pickEaIdFromObject(obj);
          if (eaId) {
            const playerName = pickPlayerNameFromObject(obj);
            let score = 30;
            if (goodPathRe.test(cur.path)) score += 40;
            if (badPathRe.test(cur.path)) score -= 60;
            if (playerName) score += 20;
            if (displayedName && playerName) score += Math.round(100 * nameSimilarityScore(displayedName, playerName));
            candidates.push({
              game: DEFAULT_GAME,
              eaId,
              playerName: playerName || null,
              score,
              source: `ui:${cur.path}`,
            });
          }

          if (depth >= MAX_DEPTH) continue;
          for (const key of Object.keys(obj)) {
            if (!key || key.startsWith('__')) continue;
            const val = obj[key];
            if (!val || typeof val !== 'object') continue;
            if (Array.isArray(val)) {
              const lim = Math.min(val.length, 6);
              for (let i = 0; i < lim; i++) {
                const child = val[i];
                if (child && typeof child === 'object') queue.push({ node: child, path: `${cur.path}.${key}[${i}]`, depth: depth + 1 });
              }
            } else {
              queue.push({ node: val, path: `${cur.path}.${key}`, depth: depth + 1 });
            }
          }
        }
      }
    }

    if (!candidates.length) {
      logLine('player: ui candidates=0');
      return null;
    }
    const filtered = candidates.filter((c) => {
      if (c.score >= 90) return true;
      const sim = displayedName && c.playerName ? nameSimilarityScore(displayedName, c.playerName) : 0;
      if (sim >= 0.6) return true;
      if (!displayedName && goodPathRe.test(c.source) && !badPathRe.test(c.source) && c.score >= 70) return true;
      return false;
    });
    if (!filtered.length) return null;
    filtered.sort((a, b) => b.score - a.score);
    const best = filtered[0];
    logLine(`player: ui candidates=${filtered.length}/${candidates.length} best=${best.game}-${best.eaId} source=${best.source}`);
    return best;
  }

  function resolvePlayerContextFromDom(detailRoot) {
    if (!detailRoot) return null;
    const linkSelectors = ['a[href*="fut.gg/players/"]', 'a[href*="/compare/"]', 'a[href*="/players/"]'];

    for (const selector of linkSelectors) {
      const links = detailRoot.querySelectorAll(selector);
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        const parsed = parseGameEaIdFromText(href);
        if (parsed && isVisible(link)) return { ...parsed, source: 'link' };
      }
    }

    const mediaNodes = detailRoot.querySelectorAll('img[src], source[srcset]');
    for (const node of mediaNodes) {
      const src = node.getAttribute('src') || node.getAttribute('srcset') || '';
      const parsed = parseGameEaIdFromText(src);
      if (parsed && isVisible(node)) return { ...parsed, source: 'media' };
    }

    const idNodes = detailRoot.querySelectorAll(
      '[data-player-definition-id], [data-definition-id], [data-entity-id], .player-definition-id, [class*="definition-id"]'
    );
    for (const node of idNodes) {
      const val =
        node.getAttribute('data-player-definition-id') ||
        node.getAttribute('data-definition-id') ||
        node.getAttribute('data-entity-id') ||
        node.textContent ||
        '';
      const ids = extractEaIdsFromText(val);
      if (ids.length) return { game: DEFAULT_GAME, eaId: ids[0], source: 'dom-id' };
    }

    return null;
  }

  function isLikelyPlayerDetailsView() {
    const selectors = [
      '.ut-item-details-view',
      '.itemDetailView',
      '.DetailPanel',
      '.ut-player-bio-view',
      '[class*="item-detail"]',
      '[class*="player-detail"]',
      '[class*="itemDetail"]',
      '[class*="playerDetail"]',
    ];
    for (const selector of selectors) {
      if (document.querySelector(selector)) return true;
    }
    const text = (document.body?.textContent || '').toLowerCase();
    if (text.includes('find lowest market price') || text.includes('copy player name')) return true;
    if (text.includes('skill moves') && text.includes('weak foot')) return true;
    if (text.includes('player bio') || text.includes('player details')) return true;
    return false;
  }

  function findPlayerContext(hostInfo) {
    const detailRoot = document.querySelector(
      '.ut-item-details-view, .itemDetailView, .DetailPanel, .ut-player-bio-view, [class*="itemDetail"], [class*="playerDetail"]'
    );
    if (!detailRoot) return null;

    const fromController = resolvePlayerContextFromController(detailRoot);
    if (fromController) return fromController;

    const fromUi = resolvePlayerContextFromUiInternals(detailRoot, hostInfo);
    if (fromUi) return fromUi;

    const fromDom = resolvePlayerContextFromDom(detailRoot);
    if (fromDom) return fromDom;

    const fromRecent = resolvePlayerContextFromRecent(detailRoot);
    if (fromRecent) return fromRecent;

    return null;
  }

  function findPlayerMenuHost() {
    const actionNodes = Array.from(document.querySelectorAll('button, [role="button"], .btn-standard, .ut-button-control'));
    for (const node of actionNodes) {
      const text = (node.textContent || '').toLowerCase().trim();
      const cls = `${node.className || ''} ${(node.id || '')}`.toLowerCase();
      if (!isVisible(node)) continue;
      const matchesText = text.includes('find lowest market price') || text.includes('copy player name');
      const matchesClass =
        cls.includes('copyplayername') || cls.includes('copy-player-name') || cls.includes('lowestmarketprice') || cls.includes('findlowest');
      if (!matchesText && !matchesClass) continue;

      const host = node.parentElement;
      if (!host) continue;
      return { host, templateNode: node };
    }

    return null;
  }

  function removePlayerMenuItem() {
    if (!state.playerMenuNode) return;
    state.playerMenuNode.remove();
    state.playerMenuNode = null;
  }

  function ensurePlayerMenuItem(hostInfo) {
    if (!hostInfo?.host) return null;
    const host = hostInfo.host;

    if (state.playerMenuNode && host.contains(state.playerMenuNode)) return state.playerMenuNode;
    removePlayerMenuItem();

    const template = hostInfo.templateNode;
    let node = null;
    if (template) {
      node = template.cloneNode(false);
      node.classList.add(PLAYER_MENU_ITEM_CLASS);
      if ('disabled' in node) node.disabled = true;
      node.removeAttribute('id');
      node.removeAttribute('data-id');
      node.textContent = 'FUT.GG: loading...';
    } else {
      node = document.createElement('div');
      node.className = PLAYER_MENU_ITEM_CLASS;
      node.textContent = 'FUT.GG: loading...';
    }

    host.appendChild(node);
    state.playerMenuNode = node;
    return node;
  }

  async function ensureChemStyleNames(game) {
    if (state.chemStyleNamesByGame.has(game)) return state.chemStyleNamesByGame.get(game);
    if (state.chemStyleNamesLoadByGame.has(game)) return state.chemStyleNamesLoadByGame.get(game);

    const promise = withHardTimeout(
      requestJson(`https://www.fut.gg/api/fut/${game}/fut-core-data/`),
      REQUEST_HARD_TIMEOUT_MS,
      'Core data request'
    )
      .then((payload) => {
        const rows = Array.isArray(payload?.data?.chemistryStyles) ? payload.data.chemistryStyles : [];
        const map = new Map();
        for (const row of rows) {
          const id = Number(row?.id);
          if (!Number.isFinite(id)) continue;
          map.set(id, toTitle(row?.name || row?.shortName || `Style ${id}`));
        }
        state.chemStyleNamesByGame.set(game, map);
        return map;
      })
      .catch((err) => {
        logLine(`player: chem style names load failed game=${game} :: ${String(err)}`);
        return new Map();
      })
      .finally(() => {
        state.chemStyleNamesLoadByGame.delete(game);
      });

    state.chemStyleNamesLoadByGame.set(game, promise);
    return promise;
  }

  function formatPlayerMenuText(playerData) {
    if (!playerData) return 'FUT.GG: no data';
    if (playerData.error) return `FUT.GG: ${playerData.error}`;

    const parts = [];
    if (playerData.playerName) parts.push(`Player ${playerData.playerName}`);
    if (Number.isFinite(playerData.userUpPct)) {
      const votesSuffix = Number.isFinite(playerData.userVotes) ? ` (${playerData.userVotes} votes)` : '';
      parts.push(`User ${playerData.userUpPct}%${votesSuffix}`);
    } else {
      parts.push('User no votes');
    }

    if (Number.isFinite(playerData.bestScore)) {
      const rankSuffix = Number.isFinite(playerData.bestRank) ? ` (#${playerData.bestRank})` : '';
      parts.push(`GG ${playerData.bestScore.toFixed(1)}${rankSuffix}`);
    }

    if (Array.isArray(playerData.topChemList) && playerData.topChemList.length) {
      parts.push(`Chem ${playerData.topChemList.join(', ')}`);
    } else {
      parts.push('Chem unavailable');
    }

    if (Number.isFinite(playerData.price) && playerData.price > 0) {
      parts.push(`Price ${formatCoins(playerData.price)}`);
    } else {
      parts.push('Price n/a');
    }

    return `FUT.GG: ${parts.join(' | ')}`;
  }

  async function loadPlayerData(game, eaId) {
    const key = `${game}-${eaId}`;
    if (state.playerCache.has(key)) return state.playerCache.get(key);

    logLine(`player: loading game=${game} eaId=${eaId}`);

    try {
      const itemPayload = await withHardTimeout(
        requestJson(`https://www.fut.gg/api/fut/player-item-definitions/${game}/${eaId}/?`),
        REQUEST_HARD_TIMEOUT_MS,
        'Player definition request'
      );
      const itemId = Number(itemPayload?.data?.id);
      const firstName = String(itemPayload?.data?.firstName || '').trim();
      const lastName = String(itemPayload?.data?.lastName || '').trim();
      const fallbackName = String(itemPayload?.data?.name || '').trim();
      const playerName = [firstName, lastName].filter(Boolean).join(' ') || fallbackName || null;
      const identifiers = Number.isFinite(itemId) ? `${PLAYER_CONTENT_TYPE}_${itemId}` : null;

      const [voteResult, metarankResult, chemResult, priceResult, chemNameMap] = await Promise.all([
        identifiers
          ? withHardTimeout(requestJson(`${FUTGG_VOTING_URL}${encodeURIComponent(identifiers)}`), REQUEST_HARD_TIMEOUT_MS, 'Player voting request')
          : Promise.resolve(null),
        withHardTimeout(requestJson(`https://www.fut.gg/api/fut/metarank/player/${eaId}/`), REQUEST_HARD_TIMEOUT_MS, 'Player metarank request'),
        withHardTimeout(requestJson(`https://www.fut.gg/api/fut/players/${game}/${eaId}/chemistry-style/`), REQUEST_HARD_TIMEOUT_MS, 'Player chemistry request'),
        withHardTimeout(requestJson(`https://www.fut.gg/api/fut/player-prices/${game}/${eaId}/`), REQUEST_HARD_TIMEOUT_MS, 'Player price request').catch(() => null),
        ensureChemStyleNames(game),
      ]);

      const voteRow = Array.isArray(voteResult?.data) ? voteResult.data[0] : null;
      const up = Number(voteRow?.upvotes || 0);
      const total = Number(voteRow?.totalVotes || up + Number(voteRow?.downvotes || 0) || 0);
      const userUpPct = total > 0 ? Math.round((up * 100) / total) : null;

      const scores = Array.isArray(metarankResult?.data?.scores) ? metarankResult.data.scores.slice() : [];
      scores.sort((a, b) => Number(b?.score || 0) - Number(a?.score || 0));
      const best = scores[0] || null;

      const topStyles = Array.isArray(chemResult?.data?.top3ChemistryStyles) ? chemResult.data.top3ChemistryStyles : [];
      const topChemList = topStyles
        .map((entry) => {
          const id = Number(Array.isArray(entry) ? entry[0] : null);
          const pct = Number(Array.isArray(entry) ? entry[1] : null);
          if (!Number.isFinite(id) || !Number.isFinite(pct)) return null;
          const name = chemNameMap.get(id) || `Style ${id}`;
          return `${name} ${pct}%`;
        })
        .filter(Boolean);

      const payload = {
        playerName,
        userUpPct,
        userVotes: total,
        bestScore: Number.isFinite(Number(best?.score)) ? Number(best.score) : null,
        bestRank: Number.isFinite(Number(best?.rank)) ? Number(best.rank) : null,
        topChemList,
        price:
          Number(priceResult?.data?.currentPrice?.price) ||
          Number(priceResult?.data?.overview?.averageBin) ||
          Number(priceResult?.data?.overview?.cheapestSale) ||
          null,
      };
      state.playerCache.set(key, payload);
      logLine(`player: loaded game=${game} eaId=${eaId} userPct=${payload.userUpPct ?? 'na'} topChem=${payload.topChemList.length}`);
      return payload;
    } catch (err) {
      const payload = { error: 'failed to load player ratings' };
      state.playerCache.set(key, payload);
      logLine(`player: load failed game=${game} eaId=${eaId} :: ${String(err)}`);
      return payload;
    }
  }

  async function scanPlayerDetails() {
    const now = Date.now();
    if (now - state.lastPlayerScanAt < 350) return;
    state.lastPlayerScanAt = now;

    installNetworkSniffer();

    if (!isLikelyPlayerDetailsView()) {
      removePlayerMenuItem();
      return;
    }

    const hostInfo = findPlayerMenuHost();
    if (!hostInfo?.host) {
      removePlayerMenuItem();
      const debugKey = 'menu-host-missing';
      if (state.lastPlayerDebugKey !== debugKey) {
        state.lastPlayerDebugKey = debugKey;
        logLine('player: menu host missing on details page');
      }
      return;
    }

    const menuItem = ensurePlayerMenuItem(hostInfo);
    if (menuItem) {
      menuItem.dataset.kind = 'info';
      menuItem.textContent = 'FUT.GG: loading...';
    }

    const ctx = findPlayerContext(hostInfo);
    if (!ctx || !Number.isFinite(ctx.eaId)) {
      if (menuItem) {
        menuItem.dataset.kind = 'warn';
        menuItem.textContent = 'FUT.GG: ID not detected (open FUT.GG Logs)';
      }
      const debugKey = `missing:${state.recentPlayerIds[0]?.eaId || 'none'}`;
      if (state.lastPlayerDebugKey !== debugKey) {
        state.lastPlayerDebugKey = debugKey;
        logLine(`player: context missing recent=${state.recentPlayerIds[0]?.eaId || 'none'} candidates=${state.recentPlayerIds.length}`);
      }
      return;
    }

    const key = `${ctx.game}-${ctx.eaId}`;
    const debugKey = `ctx:${key}:${ctx.source || 'unknown'}`;
    if (state.lastPlayerDebugKey !== debugKey) {
      state.lastPlayerDebugKey = debugKey;
      logLine(`player: context ${key} source=${ctx.source || 'unknown'}`);
    }
    const cached = state.playerCache.get(key);
    if (cached) {
      if (!menuItem) return;
      menuItem.dataset.kind = cached.error ? 'error' : 'ok';
      menuItem.textContent = formatPlayerMenuText(cached);
      return;
    }

    const payload = await loadPlayerData(ctx.game, ctx.eaId);
    if (!menuItem) return;
    menuItem.dataset.kind = payload.error ? 'error' : 'ok';
    menuItem.textContent = formatPlayerMenuText(payload);
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

    const chunkSize = 20;
    const voteMap = new Map();
    let failedChunks = 0;

    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const identifiers = chunk.map((id) => `20_${id}`).join(',');
      try {
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
      } catch (err) {
        failedChunks += 1;
        logLine(`votes: chunk failed start=${i} size=${chunk.length} :: ${String(err)}`);
      }
    }

    state.votesById = voteMap;
    logLine(`votes: loaded entries=${voteMap.size} failedChunks=${failedChunks}`);
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

    ensureSelectSortHook();
    ensureListSortHook();
    ensureSettingsLogsHook();
    ensurePaletoolsSettingsLogsHook();

    if (!state.loaded || !cards.length) return;
    const totalMatched = visibleWithChip + matched;
    if (totalMatched > 0) {
      setStatus(`matched ${totalMatched} on screen`, 'ok');
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
        display: none;
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
      .${PLAYER_MENU_ITEM_CLASS} {
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
        white-space: normal;
        line-height: 1.25;
      }
      .${PLAYER_MENU_ITEM_CLASS}[data-kind="warn"] {
        border-color: rgba(255, 196, 0, 0.85);
        color: #ffd25e;
      }
      .${PLAYER_MENU_ITEM_CLASS}[data-kind="error"] {
        border-color: rgba(255, 107, 107, 0.9);
        color: #ff8c8c;
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
    const observer = new MutationObserver(() => {
      scanCards();
      scanPlayerDetails().catch((err) => logLine(`player: scan failed ${String(err)}`));
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    setInterval(scanCards, 1500);
    setInterval(() => {
      scanPlayerDetails().catch((err) => logLine(`player: scan failed ${String(err)}`));
    }, 1500);
    scanCards();
    scanPlayerDetails().catch((err) => logLine(`player: scan failed ${String(err)}`));
  }

  async function init() {
    ensureStyles();
    ensureLogUi();
    logLine(`build: ${BUILD_ID}`);
    logLine('init: started');
    await ensureData();
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
