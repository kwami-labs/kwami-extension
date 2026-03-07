/**
 * Kwami Navigation Extension — background service worker.
 * Keeps one "navigation tab" and bridges messages between playground and that tab.
 */

const KWAMI_PLAYGROUND_ORIGINS = [
  'http://localhost',
  'https://localhost',
  'http://127.0.0.1',
  'https://127.0.0.1',
  'http://0.0.0.0',
  'https://0.0.0.0',
  'https://kwami.io',
  'https://www.kwami.io',
];

let navTabId = null;

function isPlaygroundOrigin(url) {
  try {
    const o = new URL(url).origin;
    return KWAMI_PLAYGROUND_ORIGINS.some((origin) => o === origin || o.startsWith(origin + ':') || o.endsWith('.kwami.io'));
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.source !== 'kwami-playground' && message.source !== 'kwami-nav-tab') {
    sendResponse({ ok: false });
    return true;
  }

  if (message.source === 'kwami-playground') {
    console.info('[Kwami bg] Received from playground:', message.type, message.detail?.action || '');
    handlePlaygroundMessage(message, sender.tab?.id)
      .then((res) => { console.info('[Kwami bg] Command result:', res); sendResponse(res); })
      .catch((err) => { console.warn('[Kwami bg] Command error:', err); sendResponse({ ok: false }); });
    return true;
  }

  if (message.source === 'kwami-nav-tab') {
    handleNavTabMessage(message, sender.tab?.id).then(sendResponse);
    return true;
  }

  sendResponse({ ok: false });
  return true;
});

async function handlePlaygroundMessage(message, fromTabId) {
  const { type, detail } = message;

  if (type === 'kwami:nav_command') {
    const { action, url } = detail || {};

    if (action === 'navigate' && url && typeof url === 'string') {
      const targetUrl = url.trim().startsWith('http') ? url.trim() : 'https://' + url.trim();
      if (navTabId != null) {
        try {
          await chrome.tabs.get(navTabId);
          await chrome.tabs.update(navTabId, { url: targetUrl, active: true });
        } catch {
          navTabId = null;
        }
      }
      if (navTabId == null) {
        let openerTab = null;
        if (fromTabId != null) {
          try {
            openerTab = await chrome.tabs.get(fromTabId);
          } catch (_) {}
        }
        const none = typeof chrome.tabs?.SPLIT_VIEW_ID_NONE === 'number' ? chrome.tabs.SPLIT_VIEW_ID_NONE : -1;
        const openerSplitViewId =
          openerTab &&
          typeof openerTab.splitViewId === 'number' &&
          openerTab.splitViewId !== none
            ? openerTab.splitViewId
            : null;

        const createProps = { url: targetUrl, active: false };
        if (fromTabId != null) createProps.openerTabId = fromTabId;
        if (openerTab?.windowId != null) createProps.windowId = openerTab.windowId;
        if (openerTab?.index != null && typeof openerTab.index === 'number') {
          createProps.index = openerTab.index + 1;
        }
        if (openerSplitViewId != null) createProps.splitViewId = openerSplitViewId;

        let tab;
        try {
          tab = await chrome.tabs.create(createProps);
        } catch (err) {
          const fallback = { url: targetUrl, active: false };
          if (openerTab?.windowId != null) fallback.windowId = openerTab.windowId;
          if (openerTab?.index != null && typeof openerTab.index === 'number') {
            fallback.index = openerTab.index + 1;
          }
          try {
            tab = await chrome.tabs.create(fallback);
          } catch (_) {
            try {
              tab = await chrome.tabs.create({ url: targetUrl, active: false });
            } catch (_) {
              tab = null;
            }
          }
        }
        if (tab?.id != null) {
          navTabId = tab.id;
          if (openerSplitViewId != null) {
            try {
              await chrome.tabs.update(tab.id, { splitViewId: openerSplitViewId });
            } catch (_) {}
          }
        }
      }
      await broadcastToPlayground({ type: 'kwami:ext_nav_state', url: targetUrl, title: '', isLoading: true });
      return { ok: true };
    }

    if (action === 'back' || action === 'forward' || action === 'close') {
      if (navTabId == null) {
        return { ok: true };
      }
      try {
        const tab = await chrome.tabs.get(navTabId);
        if (action === 'close') {
          await chrome.tabs.remove(navTabId);
          navTabId = null;
          await broadcastToPlayground({ type: 'kwami:ext_nav_ended' });
          return { ok: true };
        }
        await chrome.tabs.update(navTabId, { active: true });
        const results = await chrome.scripting.executeScript({
          target: { tabId: navTabId },
          func: (dir) => {
            if (dir === 'back') history.back();
            else if (dir === 'forward') history.forward();
          },
          args: [action === 'back' ? 'back' : 'forward'],
        });
        return { ok: !results?.[0]?.error };
      } catch {
        navTabId = null;
        return { ok: false };
      }
    }

    if (['click', 'type', 'press_key', 'scroll', 'read_page'].includes(action)) {
      if (navTabId == null) return { ok: false };
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: navTabId },
          func: runNavCommandInPage,
          args: [
            action,
            detail?.description ?? '',
            detail?.text ?? '',
            detail?.elementId ?? detail?.element_id ?? '',
          ],
        });
        const err = results?.[0]?.error;
        const payload = err ? null : results?.[0]?.result;
        if (payload != null) {
          await broadcastToPlayground({ type: 'kwami:ext_command_result', ...payload });
        }
        return { ok: !err };
      } catch (e) {
        return { ok: false };
      }
    }
  }

  return { ok: false };
}

async function requestAndBroadcastPageContent(tabId) {
  if (tabId == null || navTabId !== tabId) return;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: runNavCommandInPage,
      args: ['read_page', '', '', ''],
    });
    const payload = results?.[0]?.result;
    if (payload && typeof payload === 'object' && payload.title !== undefined) {
      await broadcastToPlayground({ type: 'kwami:ext_page_content', title: payload.title, text: payload.text, elements: payload.elements || [], html: payload.html || '' });
    }
  } catch (_) {}
}

async function handleNavTabMessage(message, tabId) {
  const { type, url, title, content } = message;

  if (type === 'kwami:nav_tab_ready' && tabId != null && navTabId === tabId) {
    await broadcastToPlayground({ type: 'kwami:ext_nav_state', url, title, isLoading: false });
    setTimeout(function () { requestAndBroadcastPageContent(tabId); }, 1200);
    return { ok: true };
  }

  if (type === 'kwami:nav_tab_state' && tabId === navTabId) {
    await broadcastToPlayground({ type: 'kwami:ext_nav_state', url, title, isLoading: false });
    setTimeout(function () { requestAndBroadcastPageContent(tabId); }, 800);
    return { ok: true };
  }

  if (type === 'kwami:nav_page_content' && tabId === navTabId && content) {
    await broadcastToPlayground({ type: 'kwami:ext_page_content', ...content });
    return { ok: true };
  }

  return { ok: true };
}

async function broadcastToPlayground(payload) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id == null || tab.url == null) continue;
    if (!isPlaygroundOrigin(tab.url)) continue;
    try {
      await chrome.tabs.sendMessage(tab.id, { source: 'kwami-extension', ...payload });
    } catch {
      // Tab may not have content script ready
    }
  }
}

chrome.tabs.onRemoved.addListener((removedTabId) => {
  if (removedTabId === navTabId) {
    navTabId = null;
    broadcastToPlayground({ type: 'kwami:ext_nav_ended' });
  }
});

/**
 * Injected into the nav tab to run commands. Must be a function that gets stringified.
 * Generic so it works on any website: broad selectors, rich labels (aria, id, class, name).
 */
function runNavCommandInPage(action, description, text, elementId) {
  const doc = document;
  const body = doc.body;
  if (!body) return null;
  elementId = elementId || '';

  function getLabel(el) {
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200);
    if (t) return t;
    const aria = (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || '').trim();
    if (aria) return aria;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const n = (el.name || el.type || '').trim();
      if (n) return n;
    }
    const id = (el.id || '').trim().replace(/[-_]+/g, ' ').replace(/^[^a-z0-9]+/i, '').slice(0, 50);
    if (id) return id;
    const cls = (el.className && typeof el.className === 'string' ? el.className : '').split(/\s+/).find(function (c) {
      const s = c.replace(/[-_]+/g, ' ').trim().slice(0, 40);
      return s.length > 2 && /[a-z]/i.test(s);
    });
    if (cls) return cls.replace(/[-_]+/g, ' ').trim().slice(0, 50);
    return '';
  }

  var clickableSelector = [
    'a[href]', 'button', 'input', 'select', 'textarea',
    '[type="submit"]', '[type="button"]', '[type="image"]', '[type="search"]',
    '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]', '[role="option"]', '[role="search"]',
    '[onclick]', '[tabindex="0"]',
    'div[aria-label]', 'span[aria-label]', 'svg[aria-label]',
    '[class*="search" i]', '[class*="button" i]', '[class*="btn" i]', '[class*="submit" i]',
    '[id*="search" i]', '[id*="button" i]', '[id*="btn" i]', '[id*="submit" i]',
    '[name*="search" i]', '[data-testid*="search" i]', '[data-testid*="button" i]'
  ].join(', ');

  if (action === 'read_page') {
    // Clear previous stamps
    try { doc.querySelectorAll('[data-kwami-id]').forEach(function (el) { el.removeAttribute('data-kwami-id'); }); } catch (_) {}
    const main = doc.querySelector('main, article, [role="main"], .content, #content') || body;
    const textContent = (main.innerText || '').slice(0, 5000);
    const items = [];
    try {
      doc.querySelectorAll(clickableSelector).forEach(function (el, i) {
        if (i >= 80) return;
        var label = getLabel(el);
        var eid = 'el-' + i;
        el.setAttribute('data-kwami-id', eid);
        if (label) items.push({ id: eid, type: el.tagName.toLowerCase(), label: label.slice(0, 80), index: i });
      });
    } catch (e) {}
    var html = '';
    try {
      var clone = main.cloneNode(true);
      var toRemove = clone.querySelectorAll('script, style, noscript, iframe');
      for (var r = 0; r < toRemove.length; r++) toRemove[r].remove();
      html = clone.innerHTML.replace(/\s+/g, ' ').trim().slice(0, 18000);
    } catch (err) {}
    return { result: 'ok', title: doc.title, text: textContent, elements: items, html: html };
  }

  if (action === 'scroll') {
    const delta = (description || '').toLowerCase().includes('up') ? -400 : 400;
    window.scrollBy(0, delta);
    return { result: 'ok' };
  }

  if (action === 'press_key') {
    var KEY_CODES = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Space: 32, Home: 36, End: 35, PageUp: 33, PageDown: 34 };
    var key = (text || description || 'Enter').trim() || 'Enter';
    var kc = KEY_CODES[key] || key.charCodeAt(0);
    var target = doc.activeElement || body;
    var evtOpts = { key: key, keyCode: kc, which: kc, code: key, bubbles: true, cancelable: true };
    target.dispatchEvent(new KeyboardEvent('keydown', evtOpts));
    target.dispatchEvent(new KeyboardEvent('keypress', evtOpts));
    target.dispatchEvent(new KeyboardEvent('keyup', evtOpts));
    if (key === 'Enter' && target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      var form = target.closest('form');
      if (form) {
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    }
    return { result: 'ok' };
  }

  let desc = (description || '').replace(/^__clear__/i, '').toLowerCase().trim();
  let ordinalIndex = 0;
  const ordinalMatch = desc.match(/^(first|second|third|1st|2nd|3rd|1|2|3)\s+(.+)$/);
  if (ordinalMatch) {
    const ord = ordinalMatch[1];
    desc = ordinalMatch[2].trim();
    if (ord === 'first' || ord === '1st' || ord === '1') ordinalIndex = 0;
    else if (ord === 'second' || ord === '2nd' || ord === '2') ordinalIndex = 1;
    else if (ord === 'third' || ord === '3rd' || ord === '3') ordinalIndex = 2;
  }
  const candidates = [];
  const maxCandidates = 250;
  try {
    doc.querySelectorAll(clickableSelector).forEach(function (el, i) {
      if (candidates.length >= maxCandidates) return;
      var label = getLabel(el);
      if (!label) return;
      var lower = label.toLowerCase();
      var score = 0;
      if (desc) {
        if (lower.includes(desc)) score = 4;
        else {
          var words = desc.split(/\s+/).filter(Boolean);
          var matchCount = words.filter(function (w) { return w.length >= 2 && lower.includes(w); }).length;
          if (matchCount === words.length) score = 2;
          else if (matchCount >= 1) score = 1;
        }
      } else score = 1;
      if (score > 0) candidates.push({ el: el, label: label.slice(0, 80), score: score, index: i });
    });
  } catch (e) {}
  function isVisible(el) {
    const style = doc.defaultView.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  const visible = candidates.filter(function (c) { return isVisible(c.el); });
  const sorted = (visible.length ? visible : candidates).sort((a, b) => (b.score - a.score) || (a.index - b.index));
  const pick = sorted.length === 0 ? null : sorted[Math.min(ordinalIndex, sorted.length - 1)];

  function doClick(el) {
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
    var rect = el.getBoundingClientRect();
    var x = rect.left + rect.width / 2;
    var y = rect.top + rect.height / 2;
    el.focus();
    var opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, detail: 1 };
    var order = ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'click'];
    if (typeof PointerEvent === 'undefined') order = ['mousedown', 'mouseup', 'click'];
    for (var i = 0; i < order.length; i++) {
      var name = order[i];
      var ev = name.indexOf('pointer') === 0 && typeof PointerEvent !== 'undefined'
        ? new PointerEvent(name, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse' })
        : new MouseEvent(name, opts);
      el.dispatchEvent(ev);
    }
  }

  if (action === 'click') {
    var byId = String(elementId || '').match(/^el-(\d+)$/);
    if (byId) {
      // Prefer stable data-kwami-id attribute set during read_page
      var stamped = doc.querySelector('[data-kwami-id="' + elementId + '"]');
      if (stamped) {
        doClick(stamped);
        return { result: 'ok' };
      }
      // Fallback to index-based lookup
      var idx = parseInt(byId[1], 10);
      var all = [];
      try {
        doc.querySelectorAll(clickableSelector).forEach(function (el) { all.push(el); });
      } catch (e) {}
      if (idx >= 0 && idx < all.length) {
        doClick(all[idx]);
        return { result: 'ok' };
      }
    }
    if (pick?.el) {
      doClick(pick.el);
      return { result: 'ok' };
    }
    return { result: 'not_found' };
  }

  if (action === 'type') {
    var input = null;
    // Priority 1: element_id (same as click)
    var typeById = String(elementId || '').match(/^el-(\d+)$/);
    if (typeById) {
      var found = doc.querySelector('[data-kwami-id="' + elementId + '"]');
      if (!found) {
        var typeIdx = parseInt(typeById[1], 10);
        var typeAll = [];
        try { doc.querySelectorAll(clickableSelector).forEach(function (el) { typeAll.push(el); }); } catch (e) {}
        if (typeIdx >= 0 && typeIdx < typeAll.length) found = typeAll[typeIdx];
      }
      if (found) input = found;
    }
    // Priority 2: fuzzy match from description
    if (!input && pick?.el) input = pick.el;
    // Priority 3: currently focused element
    if (!input) {
      var active = doc.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
        input = active;
      }
    }
    if (!input) return { result: 'not_found' };
    var clearFirst = (description || '').indexOf('__clear__') === 0;
    if (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA') {
      input.focus();
      input.click();
      var newValue = clearFirst ? (text || '') : (input.value || '') + (text || '');
      var nativeSet = Object.getOwnPropertyDescriptor(
        input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, 'value'
      )?.set;
      if (nativeSet) nativeSet.call(input, newValue);
      else input.value = newValue;
      input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text || '' }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));
      input.focus();
      return { result: 'ok' };
    }
    if (input.isContentEditable) {
      input.focus();
      input.click();
      if (clearFirst) {
        doc.execCommand('selectAll', false, null);
        doc.execCommand('delete', false, null);
      }
      doc.execCommand('insertText', false, text || '');
      return { result: 'ok' };
    }
    return { result: 'not_input' };
  }

  return { result: 'ok' };
}
