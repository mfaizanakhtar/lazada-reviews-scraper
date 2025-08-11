chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'DOWNLOAD_CSV') {
      try {
        const url = 'data:text/csv;charset=utf-8,' + encodeURIComponent(msg.csv || '');
        chrome.downloads.download(
          { url, filename: msg.filename || 'reviews.csv', saveAs: false },
          (downloadId) => {
            if (chrome.runtime.lastError) {
              sendResponse({ ok: false, error: chrome.runtime.lastError.message });
            } else {
              sendResponse({ ok: true, id: downloadId });
            }
          }
        );
        return true; // keep channel open for async sendResponse
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    }
  });
  