/**
 * Kwami Navigation Extension — background service worker.
 * Keeps one "navigation tab" and bridges messages between playground and that tab.
 */

const KWAMI_PLAYGROUND_ORIGINS = [
  'http://localhost',
  'https://localhost',
  'https://kwami.io',
  'https://www.kwami.io',
];

let navTabId = null;

function isPlaygroundOrigin(url) {
  try {
    const o = new URL(url).origin;
    return KWAMI_PLAYGROUND_ORIGINS.some((origin) => o === origin || o.endsWith('.kwami.io'));
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
    handlePlaygroundMessage(message, sender.tab?.id).then(sendResponse);
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

    if (action === 'navigate' && url) {
      if (navTabId != null) {
        try {
          await chrome.tabs.get(navTabId);
          await chrome.tabs.update(navTabId, { url, active: true });
        } catch {
          navTabId = null;
        }
      }
      if (navTabId == null) {
        const tab = await chrome.tabs.create({ url, active: false });
        navTabId = tab.id;
      }
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

async function handleNavTabMessage(message, tabId) {
  const { type, url, title, content } = message;

  if (type === 'kwami:nav_tab_ready' && tabId != null && navTabId === tabId) {
    await broadcastToPlayground({ type: 'kwami:ext_nav_state', url, title, isLoading: false });
    return { ok: true };
  }

  if (type === 'kwami:nav_tab_state' && tabId === navTabId) {
    await broadcastToPlayground({ type: 'kwami:ext_nav_state', url, title, isLoading: false });
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
 */
function runNavCommandInPage(action, description, text) {
  const doc = document;
  const body = doc.body;
  if (!body) return null;

  if (action === 'read_page') {
    const main = doc.querySelector('main, article, [role="main"], .content, #content') || body;
    const textContent = (main.innerText || '').slice(0, 5000);
    const items = [];
    doc.querySelectorAll('a[href], button, input, [role="button"], [role="link"]').forEach((el, i) => {
      if (i >= 50) return;
      const label = (el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().slice(0, 80);
      if (label) items.push({ type: el.tagName.toLowerCase(), label, index: i });
    });
    return { result: 'ok', title: doc.title, text: textContent, elements: items };
  }

  if (action === 'scroll') {
    const delta = (description || '').toLowerCase().includes('up') ? -400 : 400;
    window.scrollBy(0, delta);
    return { result: 'ok' };
  }

  if (action === 'press_key') {
    const key = (text || description || 'Enter').trim() || 'Enter';
    body.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode: key.charCodeAt(0), bubbles: true }));
    body.dispatchEvent(new KeyboardEvent('keyup', { key, keyCode: key.charCodeAt(0), bubbles: true }));
    return { result: 'ok' };
  }

  const desc = (description || '').toLowerCase().trim();
  const candidates = [];
  doc.querySelectorAll('a[href], button, input, [role="button"], [role="link"], [onclick]').forEach((el, i) => {
    const label = (el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || '').trim();
    if (!label) return;
    const score = desc ? (label.toLowerCase().includes(desc) ? 2 : (label.toLowerCase().indexOf(desc.slice(0, 4)) >= 0 ? 1 : 0)) : 0;
    if (score > 0 || !desc) candidates.push({ el, label: label.slice(0, 80), score, index: i });
  });

  const pick = candidates.length === 0 ? null : candidates.sort((a, b) => (b.score - a.score) || (a.index - b.index))[0];

  if (action === 'click') {
    if (pick?.el) {
      pick.el.click();
      return { result: 'ok' };
    }
    return { result: 'not_found' };
  }

  if (action === 'type' && pick?.el) {
    const input = pick.el;
    if (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA') {
      input.focus();
      input.value = (input.value || '') + (text || '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return { result: 'ok' };
    }
    return { result: 'not_input' };
  }

  return { result: 'ok' };
}
