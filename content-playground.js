/**
 * Kwami Navigation Extension — content script injected into the Kwami playground.
 * Bridges postMessage from the page to the extension and forwards extension messages to the page.
 * Injects a script into the page context so the app can see __KWAMI_EXTENSION__ (content script world is isolated).
 */

const SOURCE = 'kwami-extension';

(function () {
  const injectPageFlag = () => {
    const script = document.createElement('script');
    script.textContent = 'window.__KWAMI_EXTENSION__ = true;';
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  };
  if (document.documentElement) {
    injectPageFlag();
  } else {
    document.addEventListener('DOMContentLoaded', injectPageFlag);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'kwami-playground') return;
    if (data.type !== 'kwami:nav_command') return;

    chrome.runtime.sendMessage(
      { source: 'kwami-playground', type: data.type, detail: data.detail },
      (response) => {
        if (chrome.runtime.lastError) return;
        if (data.detail?.callbackId && response != null) {
          window.postMessage({ source: SOURCE, type: 'kwami:ext_callback', callbackId: data.detail.callbackId, response }, '*');
        }
      }
    );
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.source !== SOURCE) {
      sendResponse();
      return false;
    }
    window.postMessage(message, '*');
    sendResponse();
    return false;
  });
})();
