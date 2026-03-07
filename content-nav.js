/**
 * Kwami Navigation Extension — content script in every tab.
 * Sends URL/title and page content to the background so the playground (and agent) stay in sync.
 */

function isContextValid() {
  try {
    return typeof chrome !== 'undefined' && chrome.runtime?.id;
  } catch {
    return false;
  }
}

function safeSendMessage(payload) {
  if (!isContextValid()) return;
  try {
    // Omit callback so Chrome never invokes one after context may be invalidated.
    chrome.runtime.sendMessage(payload);
  } catch (_) {}
}

(function () {
  if (!isContextValid()) return;

  function sendReady() {
    safeSendMessage({
      source: 'kwami-nav-tab',
      type: 'kwami:nav_tab_ready',
      url: window.location.href,
      title: document.title,
    });
  }

  function sendState() {
    safeSendMessage({
      source: 'kwami-nav-tab',
      type: 'kwami:nav_tab_state',
      url: window.location.href,
      title: document.title,
    });
  }

  sendReady();
  sendState();
  // Page content (with HTML and element ids) is requested by the background via executeScript
  // so the agent sees what the user sees and can click by element id.

  var debounceTimer = null;
  const observer = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(sendState, 1500);
  });
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener('popstate', sendState);
  window.addEventListener('hashchange', sendState);
})();
