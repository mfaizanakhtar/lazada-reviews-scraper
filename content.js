// Minimal content-side UI toast
function toast(msg, ms = 2000) {
    const n = document.createElement('div');
    n.textContent = msg;
    Object.assign(n.style, {
      position: 'fixed', top: '16px', right: '16px',
      background: '#111827', color: '#fff', padding: '10px 12px',
      zIndex: 999999, borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,.2)',
      font: '13px/1.3 system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
    });
    document.body.appendChild(n);
    setTimeout(() => n.remove(), ms);
  }
  
  let ABORT = false;
  
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function randomDelay(min, max) { return sleep(min + Math.random() * (max - min)); }
  
  function getCurrentPageNumber() {
    const txt = document.querySelector(".review-pagination .next-pagination-list .current")?.textContent.trim();
    return txt ? parseInt(txt, 10) : null;
  }
  function getTotalPages() {
    const nodes = [...document.querySelectorAll(".review-pagination .next-pagination-list .next-pagination-item:not(.prev):not(.next)")];
    const nums = nodes.map(b => parseInt(b.textContent.trim(), 10)).filter(n => !isNaN(n));
    return nums.length ? Math.max(...nums) : null;
  }
  function isNextDisabled() {
    const btn = document.querySelector(".review-pagination .next-pagination-item.next");
    if (!btn) return true;
    return btn.disabled || btn.classList.contains("disabled") || btn.getAttribute("aria-disabled") === "true";
  }
  
  function waitForReviewsChange(timeoutMs = 8000) {
    return new Promise(resolve => {
      const container = document.querySelector(".mod-reviews");
      if (!container) return resolve(false);
      const start = container.innerHTML;
      let settled = false;
      const obs = new MutationObserver(() => {
        if (!settled && container.innerHTML !== start) {
          settled = true; obs.disconnect(); resolve(true);
        }
      });
      obs.observe(container, { childList: true, subtree: true });
      setTimeout(() => { if (!settled) { obs.disconnect(); resolve(false); } }, timeoutMs);
    });
  }
  
  async function clickNextAndWait(afterLoadBufferMs = 250) {
    const before = getCurrentPageNumber();
    if (isNextDisabled()) return false;
    document.querySelector(".review-pagination .next-pagination-item.next")?.click();
    const changed = await waitForReviewsChange();
    await sleep(afterLoadBufferMs);
    const after = getCurrentPageNumber();
    return !!changed && !(before != null && after != null && after === before);
  }
  
  function toAbs(url) {
    if (!url) return null;
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith("//")) return location.protocol + url;
    if (url.startsWith("/")) return location.origin + url;
    try { return new URL(url, location.href).href; } catch { return url; }
  }
  
  // Robust star extraction (handles filled vs empty sprites)
  function extractRating(item) {
    const top = item.querySelector(".top");
    const cont = top?.querySelector(".container-star");
    if (!cont) return null;
  
    // 1) aria-label/title (e.g., "4 out of 5")
    for (const el of top.querySelectorAll("[aria-label],[title]")) {
      const t = el.getAttribute("aria-label") || el.getAttribute("title") || "";
      const m = t.match(/(\d+(?:\.\d+)?)\s*(?:\/|out of)\s*5/i) || t.match(/rated\s*(\d+(?:\.\d+)?)\s*stars?/i);
      if (m) return Math.round(parseFloat(m[1]));
    }
  
    // 2) Heuristic via <img.star>
    const stars = [...cont.querySelectorAll("img.star")];
    if (stars.length) {
      let filled = 0, empty = 0;
      for (const img of stars) {
        const src = (img.getAttribute("src") || img.getAttribute("data-src") || "").toLowerCase();
        const cls = (img.getAttribute("class") || "").toLowerCase();
        const styles = getComputedStyle(img);
        const filter = (styles.filter || "").toLowerCase();
        const op = parseFloat(styles.opacity || "1");
  
        const looksEmpty = /gray|grey|empty|inactive|hollow|outline|off|muted|disabled|tb18/.test(src)
          || /empty|off|inactive|hollow|outline/.test(cls)
          || /grayscale\((1|100%)\)/.test(filter)
          || op < 0.8;
  
        const looksFilled = /yellow|gold|full|active|filled|tb19/.test(src)
          || /on|active|full|filled/.test(cls);
  
        if (looksEmpty && !looksFilled) empty++;
        else filled++;
      }
      return Math.max(0, Math.min(5, filled));
    }
  
    return null;
  }
  
  function extractImages(item) {
    const urls = new Set();
    for (const img of item.querySelectorAll("img")) {
      if (img.closest(".container-star")) continue;
      if (img.classList.contains("verifyImg") || img.classList.contains("lazadaicon") || img.classList.contains("star")) continue;
      const candidates = [img.getAttribute("src"), img.getAttribute("data-src"), img.getAttribute("data-ks-lazyload"), img.getAttribute("data-original")].filter(Boolean);
      for (const c of candidates) {
        const abs = toAbs(c); if (abs) urls.add(abs);
      }
    }
    for (const el of item.querySelectorAll("[style*='background-image']")) {
      const m = (el.getAttribute("style") || "").match(/url\(["']?(.*?)["']?\)/i);
      if (m?.[1]) { const abs = toAbs(m[1]); if (abs) urls.add(abs); }
    }
    return [...urls];
  }
  
  function extractReviewsOnPage(withImages) {
    const rows = [];
    for (const item of document.querySelectorAll(".mod-reviews .item")) {
      const rating = extractRating(item);
      const dateText = item.querySelector(".top .title.right")?.textContent.trim() || null;
      const user = item.querySelector(".middle > span:first-child")?.textContent.trim() || null;
      const verified = !!item.querySelector(".verify");
      const content = (item.querySelector(".item-content .content")?.textContent || "").replace(/\s+/g, " ").trim();
      const skuInfo = (item.querySelector(".item-content .skuInfo")?.textContent || "").replace(/\s+/g, " ").trim();
      const likesText = item.querySelector(".bottom .left .left-content span:last-child")?.textContent.trim() || "";
      const likes = likesText ? (parseInt(likesText, 10) || 0) : 0;
      const images = withImages ? extractImages(item) : [];
      rows.push({ rating, date: dateText, user, verified, content, sku: skuInfo, likes, images });
    }
    return rows;
  }
  
function toCSV(rows) {
  const headers = ["rating","date","user","verified","content","sku","likes","images"];
  const esc = v => {
    if (v == null) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    const imagesJoined = (r.images && r.images.length) ? r.images.join(" | ") : "";
    lines.push([esc(r.rating),esc(r.date),esc(r.user),esc(r.verified),esc(r.content),esc(r.sku),esc(r.likes),esc(imagesJoined)].join(","));
  }
  return lines.join("\n");
}

function fallbackDownloadInPage(csv, filename = 'reviews.csv') {
  try {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
    return true;
  } catch (e) {
    console.warn('Fallback download failed:', e);
    return false;
  }
}

function saveCSV(csv, filename = 'reviews.csv') {
  let responded = false;
  const timer = setTimeout(() => {
    if (!responded) {
      console.warn('Background did not respond in time; using fallback.');
      const ok = fallbackDownloadInPage(csv, filename);
      toast(ok ? '✅ CSV saved (fallback)' : '❌ CSV save failed', 3000);
    }
  }, 1500);

  chrome.runtime.sendMessage(
    { type: 'DOWNLOAD_CSV', filename, csv },
    (res) => {
      responded = true;
      clearTimeout(timer);
      if (res && res.ok) {
        toast('✅ CSV saved', 2500);
      } else {
        console.warn('Background download failed:', res?.error);
        const ok = fallbackDownloadInPage(csv, filename);
        toast(ok ? '✅ CSV saved (fallback)' : `❌ CSV save failed: ${res?.error || 'Unknown'}`, 3500);
      }
    }
  );
}
  
  async function runScraper(opts) {
    const { MAX_PAGES = null, DELAY_MIN_MS = 1000, DELAY_MAX_MS = 3000, WITH_IMAGES = true } = opts || {};
    ABORT = false;
    toast("✅ Scraper started");
  
    const all = [];
    const seen = new Set();
    let pages = 0;
  
    while (!ABORT) {
      pages++;
      const cur = getCurrentPageNumber();
      const total = getTotalPages();
      console.log(`Scraping page ${cur ?? pages}${total ? ` of ~${total}` : ""}`);
  
      await randomDelay(250, 600); // feel human before scraping
  
      for (const r of extractReviewsOnPage(WITH_IMAGES)) {
        const key = [r.user, r.date, r.content].join("|");
        if (!seen.has(key)) { seen.add(key); all.push(r); }
      }
  
      if ((total != null && cur != null && cur >= total) || isNextDisabled()) break;
      if (MAX_PAGES != null && pages >= MAX_PAGES) break;
  
      await randomDelay(DELAY_MIN_MS, DELAY_MAX_MS); // before next click
      const moved = await clickNextAndWait(250);
      if (!moved) break;
    }
  
  const csv = toCSV(all);
  saveCSV(csv, 'reviews.csv');
  toast(`✅ Done. ${all.length} reviews, ${pages} page(s).`, 3000);
  }
  
  // Message bridge with popup
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'START_SCRAPE') runScraper(msg.opts);
    if (msg?.type === 'STOP_SCRAPE') { ABORT = true; toast("⏹️ Stopping..."); }
  });
  