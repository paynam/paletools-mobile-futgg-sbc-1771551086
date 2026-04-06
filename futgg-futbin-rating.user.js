// ==UserScript==
// @name         FUT.GG FUTBIN Rating
// @namespace    https://github.com/paynam/paletools-mobile-futgg-sbc-1771551086
// @version      2026.04.05.01
// @description  Show FUTBIN rating on FUT.GG player pages.
// @author       Codex
// @match        https://www.fut.gg/players/*
// @grant        GM_xmlhttpRequest
// @connect      futbin.com
// ==/UserScript==

(function () {
  'use strict';

  const BUILD_ID = 'futgg-futbin-20260405-01';
  const BADGE_ID = 'pt-futbin-rating-chip';
  const STYLE_ID = 'pt-futbin-rating-style';
  const SEARCH_ENDPOINT = 'https://www.futbin.com/players/search?targetPage=PLAYER_PAGE';

  const gmRequest =
    typeof GM_xmlhttpRequest === 'function'
      ? GM_xmlhttpRequest
      : (typeof GM !== 'undefined' && typeof GM.xmlHttpRequest === 'function' ? GM.xmlHttpRequest.bind(GM) : null);

  if (!gmRequest) {
    console.warn('[FUTBIN]', 'GM_xmlhttpRequest is unavailable.');
    return;
  }

  function log(message, extra) {
    if (typeof extra === 'undefined') {
      console.log('[FUTBIN]', BUILD_ID, message);
      return;
    }
    console.log('[FUTBIN]', BUILD_ID, message, extra);
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${BADGE_ID} {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        background: linear-gradient(135deg, #1f2a44 0%, #0b5fff 100%);
        color: #fff;
        font-weight: 700;
        font-size: 13px;
        line-height: 1;
        box-shadow: 0 8px 24px rgba(11, 95, 255, 0.24);
        margin-top: 10px;
        width: fit-content;
      }
      #${BADGE_ID}[data-state="loading"] {
        background: linear-gradient(135deg, #505a6e 0%, #283142 100%);
      }
      #${BADGE_ID}[data-state="error"] {
        background: linear-gradient(135deg, #6a2d2d 0%, #a43737 100%);
      }
      #${BADGE_ID} .pt-futbin-label {
        opacity: 0.82;
        letter-spacing: 0.04em;
      }
      #${BADGE_ID} .pt-futbin-value {
        font-size: 16px;
      }
      #${BADGE_ID} a {
        color: inherit;
        text-decoration: none;
      }
    `;
    document.head.appendChild(style);
  }

  function getPathInfo() {
    const match = window.location.pathname.match(/^\/players\/(\d+)-[^/]+\/(\d+)-(\d+)\/?$/i);
    if (!match) return null;
    return {
      basePlayerId: match[1],
      year: match[2],
      itemEaId: match[3],
    };
  }

  function getHeadingElement() {
    return document.querySelector('h1');
  }

  function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function derivePlayerName(pathInfo) {
    const heading = getHeadingElement();
    const headingText = normalizeWhitespace(heading && heading.textContent);
    if (headingText) {
      const cleaned = headingText.replace(/\s+\d+\s*OVR\s*-\s*EA\s*FC\s*\d+.*$/i, '').trim();
      if (cleaned) return cleaned;
    }

    const title = normalizeWhitespace(document.title);
    if (title) {
      const cleaned = title.replace(/\s+\d+\s*OVR\s*-\s*FUT\.GG.*$/i, '').trim();
      if (cleaned) {
        const tokens = cleaned.split(' ');
        if (tokens.length >= 2) return tokens.slice(0, 2).join(' ');
        return cleaned;
      }
    }

    const slugBits = window.location.pathname.split('/')[2] || '';
    const parts = slugBits.split('-').slice(1);
    if (parts.length) {
      return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
    }

    return pathInfo ? pathInfo.basePlayerId : '';
  }

  function ensureBadge() {
    ensureStyle();
    let badge = document.getElementById(BADGE_ID);
    if (badge) return badge;

    badge = document.createElement('div');
    badge.id = BADGE_ID;
    badge.innerHTML = '<span class="pt-futbin-label">FUTBIN</span><span class="pt-futbin-value">...</span>';

    const heading = getHeadingElement();
    if (heading && heading.parentElement) {
      heading.parentElement.appendChild(badge);
      return badge;
    }

    const mount = document.body || document.documentElement;
    mount.appendChild(badge);
    badge.style.position = 'fixed';
    badge.style.top = '72px';
    badge.style.left = '16px';
    badge.style.zIndex = '999999';
    return badge;
  }

  function setBadge(state, value, href) {
    const badge = ensureBadge();
    badge.dataset.state = state;
    if (href) {
      badge.innerHTML = '<span class="pt-futbin-label">FUTBIN</span><a class="pt-futbin-value" target="_blank" rel="noreferrer noopener"></a>';
      const link = badge.querySelector('a');
      link.href = href;
      link.textContent = value;
      return;
    }
    badge.innerHTML = '<span class="pt-futbin-label">FUTBIN</span><span class="pt-futbin-value"></span>';
    badge.querySelector('.pt-futbin-value').textContent = value;
  }

  function gmGetJson(url) {
    return new Promise((resolve, reject) => {
      gmRequest({
        method: 'GET',
        url,
        headers: {
          Accept: 'application/json, text/plain, */*',
          'X-Requested-With': 'XMLHttpRequest',
        },
        onload(response) {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error('HTTP ' + response.status));
            return;
          }
          try {
            resolve(JSON.parse(response.responseText));
          } catch (error) {
            reject(error);
          }
        },
        onerror() {
          reject(new Error('Network error'));
        },
        ontimeout() {
          reject(new Error('Timeout'));
        },
        timeout: 15000,
      });
    });
  }

  function collectStrings(value, out) {
    if (!value) return;
    if (typeof value === 'string') {
      out.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collectStrings(item, out);
      return;
    }
    if (typeof value === 'object') {
      for (const item of Object.values(value)) collectStrings(item, out);
    }
  }

  function extractCandidateImageUrls(candidate) {
    const values = [];
    collectStrings(candidate && candidate.playerImage, values);
    return values.filter((value) => /\/p\d+\.png/i.test(value));
  }

  function matchCandidateByEaItemId(candidates, itemEaId) {
    const marker = 'p' + itemEaId + '.png';
    return (candidates || []).find((candidate) =>
      extractCandidateImageUrls(candidate).some((url) => url.toLowerCase().includes(marker.toLowerCase()))
    );
  }

  function getCandidateRating(candidate) {
    const rating = candidate && candidate.ratingSquare && candidate.ratingSquare.rating;
    if (rating) return String(rating);
    if (candidate && candidate.rating) return String(candidate.rating);
    return '';
  }

  function getCandidateUrl(candidate) {
    const location = candidate && candidate.location && candidate.location.url;
    if (!location) return '';
    return new URL(location, 'https://www.futbin.com').toString();
  }

  async function loadAndRender() {
    const pathInfo = getPathInfo();
    if (!pathInfo) return;

    const existing = document.getElementById(BADGE_ID);
    if (existing && existing.dataset.itemEaId === pathInfo.itemEaId) return;

    const badge = ensureBadge();
    badge.dataset.itemEaId = pathInfo.itemEaId;
    setBadge('loading', 'Loading...');

    const playerName = derivePlayerName(pathInfo);
    const searchUrl =
      SEARCH_ENDPOINT +
      '&query=' + encodeURIComponent(playerName) +
      '&year=' + encodeURIComponent(pathInfo.year) +
      '&evolutions=false';

    log('search', { playerName, searchUrl, itemEaId: pathInfo.itemEaId });

    try {
      const candidates = await gmGetJson(searchUrl);
      if (!Array.isArray(candidates) || !candidates.length) {
        setBadge('error', 'Not found');
        return;
      }

      const exact = matchCandidateByEaItemId(candidates, pathInfo.itemEaId);
      const candidate = exact || candidates[0];
      const rating = getCandidateRating(candidate);
      const href = getCandidateUrl(candidate);

      log('match', {
        exact: !!exact,
        candidateId: candidate && candidate.id,
        rating,
        href,
      });

      if (!rating) {
        setBadge('error', 'No rating');
        return;
      }

      setBadge('ready', rating, href || '');
    } catch (error) {
      console.error('[FUTBIN]', BUILD_ID, error);
      setBadge('error', 'Error');
    }
  }

  let lastPath = '';
  function tick() {
    if (!window.location.pathname.startsWith('/players/')) return;
    if (window.location.pathname === lastPath && document.getElementById(BADGE_ID)) return;
    lastPath = window.location.pathname;
    loadAndRender();
  }

  const observer = new MutationObserver(() => {
    tick();
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    window.addEventListener('DOMContentLoaded', () => {
      if (document.body) observer.observe(document.body, { childList: true, subtree: true });
      tick();
    }, { once: true });
  }

  tick();
})();
