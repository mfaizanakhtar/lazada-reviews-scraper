async function getActiveTabId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id;
  }
  
  function getOptionsFromUI() {
    const maxPages = document.getElementById('maxPages').value;
    const delayMin = Number(document.getElementById('delayMin').value || 1000);
    const delayMax = Number(document.getElementById('delayMax').value || 3000);
    const withImages = document.getElementById('withImages').checked;
  
    return {
      MAX_PAGES: maxPages ? Number(maxPages) : null,
      DELAY_MIN_MS: delayMin,
      DELAY_MAX_MS: delayMax,
      WITH_IMAGES: withImages
    };
  }
  
  document.getElementById('start').addEventListener('click', async () => {
    const tabId = await getActiveTabId();
    if (!tabId) return;
  
    const opts = getOptionsFromUI();
    chrome.tabs.sendMessage(tabId, { type: 'START_SCRAPE', opts });
  });
  
  document.getElementById('stop').addEventListener('click', async () => {
    const tabId = await getActiveTabId();
    if (!tabId) return;
    chrome.tabs.sendMessage(tabId, { type: 'STOP_SCRAPE' });
  });
  