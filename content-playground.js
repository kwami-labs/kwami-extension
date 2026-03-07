/**
 * Kwami Navigation Extension — content script injected into the Kwami playground.
 * Bridges postMessage from the page to the extension and forwards extension messages to the page.
 */

const SOURCE = 'kwami-extension';

function isContextValid() {
  try {
    return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

function safeSendMessage(payload, callback) {
  if (!isContextValid()) {
    console.warn('[Kwami ext] Extension context invalidated — reload this page to restore navigation.');
    window.postMessage({ source: SOURCE, type: 'kwami:ext_disconnected' }, '*');
    return false;
  }
  try {
    chrome.runtime.sendMessage(payload, (response) => {
      try {
        if (chrome.runtime?.lastError) {
          console.warn('[Kwami ext] sendMessage error:', chrome.runtime.lastError.message);
          return;
        }
        if (typeof callback === 'function') callback(response);
      } catch (_) {}
    });
    return true;
  } catch (e) {
    console.warn('[Kwami ext] sendMessage failed:', e);
    return false;
  }
}

(function () {
  if (!isContextValid()) {
    console.warn('[Kwami ext] Content script loaded but extension context is invalid — reload this page.');
    return;
  }

  console.info('[Kwami ext] Navigation bridge active.');

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'kwami-playground') return;
    if (data.type !== 'kwami:nav_command') return;

    var sent = safeSendMessage(
      { source: 'kwami-playground', type: data.type, detail: data.detail },
      (response) => {
        if (data.detail?.callbackId && response != null) {
          window.postMessage({ source: SOURCE, type: 'kwami:ext_callback', callbackId: data.detail.callbackId, response }, '*');
        }
      }
    );
    if (!sent) {
      console.error('[Kwami ext] Failed to forward nav command to extension. Reload this page after reloading the extension.');
    }
  });

  try {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      try {
        if (message.source !== SOURCE) {
          sendResponse();
          return false;
        }
        window.postMessage(message, '*');
        sendResponse();
      } catch (_) {
        sendResponse();
      }
      return false;
    });
  } catch (_) {}
})();
