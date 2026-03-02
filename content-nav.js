/**
 * Kwami Navigation Extension — content script in every tab.
 * Only the tab designated as "nav tab" by the background reports state and runs commands.
 * Sends URL/title and page content to the background so the playground (and agent) stay in sync.
 */

(function () {
  function sendReady() {
    chrome.runtime.sendMessage(
      {
        source: 'kwami-nav-tab',
        type: 'kwami:nav_tab_ready',
        url: window.location.href,
        title: document.title,
      },
      () => {}
    );
  }

  function sendState() {
    chrome.runtime.sendMessage(
      {
        source: 'kwami-nav-tab',
        type: 'kwami:nav_tab_state',
        url: window.location.href,
        title: document.title,
      },
      () => {}
    );
  }

  function sendPageContent() {
    try {
      const doc = document;
      const body = doc.body;
      if (!body) return;
      const main = doc.querySelector('main, article, [role="main"], .content, #content') || body;
      const text = (main.innerText || '').slice(0, 5000);
      const elements = [];
      doc.querySelectorAll('a[href], button, input, [role="button"], [role="link"]').forEach((el, i) => {
        if (i >= 50) return;
        const label = (el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().slice(0, 80);
        if (label) elements.push({ type: el.tagName.toLowerCase(), label, index: i });
      });
      chrome.runtime.sendMessage(
        {
          source: 'kwami-nav-tab',
          type: 'kwami:nav_page_content',
          content: { title: doc.title, text, elements },
        },
        () => {}
      );
    } catch (e) {
      console.warn('Kwami ext: sendPageContent error', e);
    }
  }

  sendReady();
  sendState();
  setTimeout(sendPageContent, 1500);

  const observer = new MutationObserver(() => {
    sendState();
  });
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener('popstate', sendState);
  window.addEventListener('hashchange', sendState);
})();
