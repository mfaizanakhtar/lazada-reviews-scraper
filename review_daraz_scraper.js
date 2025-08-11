(async function () {
  // ==== User settings ====
  const MAX_PAGES = null; // set to a number to limit pages, e.g. 5; null = no limit (scrape all)
  const DELAY_MIN_MS = 1000;   // min delay before next page
  const DELAY_MAX_MS = 3000;   // max delay before next page
  const AFTER_LOAD_BUFFER_MS = 250; // delay after DOM change
  // =======================

  // Ensure jQuery
  if (typeof window.jQuery === "undefined") {
    let s = document.createElement("script");
    s.src = "https://code.jquery.com/jquery-3.7.1.min.js";
    document.head.appendChild(s);
    await new Promise(r => (s.onload = r));
  }
  const $ = window.jQuery;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const randomDelay = (minMs, maxMs) => sleep(minMs + Math.random() * (maxMs - minMs));

  function waitForReviewsChange($container, timeoutMs = 8000) {
    return new Promise((resolve) => {
      const startHTML = $container.html();
      let settled = false;
      const obs = new MutationObserver(() => {
        if (!settled && $container.html() !== startHTML) {
          settled = true;
          obs.disconnect();
          resolve(true);
        }
      });
      obs.observe($container.get(0), { childList: true, subtree: true });
      setTimeout(() => {
        if (!settled) {
          obs.disconnect();
          resolve(false);
        }
      }, timeoutMs);
    });
  }

  // Pagination helpers
  function getCurrentPageNumber() {
    const txt = $(".review-pagination .next-pagination-list .current").text().trim();
    return txt ? parseInt(txt, 10) : null;
  }
  function getTotalPages() {
    const nums = $(".review-pagination .next-pagination-list .next-pagination-item")
      .not(".prev, .next")
      .map(function () {
        const t = $(this).text().trim();
        const n = parseInt(t, 10);
        return isNaN(n) ? null : n;
      }).get()
      .filter(n => n != null);
    return nums.length ? Math.max(...nums) : null;
  }
  function isNextDisabled() {
    const $next = $(".review-pagination .next-pagination-item.next");
    if ($next.length === 0) return true;
    return $next.prop("disabled") || $next.hasClass("disabled") || $next.attr("aria-disabled") === "true";
  }
  async function clickNextAndWait() {
    const $container = $(".mod-reviews");
    const before = getCurrentPageNumber();
    if (isNextDisabled()) return false;
    $(".review-pagination .next-pagination-item.next").trigger("click");
    const changed = await waitForReviewsChange($container);
    await sleep(AFTER_LOAD_BUFFER_MS);
    const after = getCurrentPageNumber();
    if (!changed || (before != null && after != null && after === before)) return false;
    return true;
  }

  // URL normalizer (for images)
  function toAbs(url) {
    if (!url) return null;
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith("//")) return location.protocol + url;
    if (url.startsWith("/")) return location.origin + url;
    try { return new URL(url, location.href).href; } catch { return url; }
  }

  // --- FIXED: robust star rating extraction ---
  function extractRating($it) {
    const $top = $it.find(".top");
    const $cont = $top.find(".container-star").first();

    // 1) aria-label/title like "4 out of 5" or "4/5"
    let meta = null;
    $top.find("[aria-label],[title]").each(function () {
      const t = $(this).attr("aria-label") || $(this).attr("title") || "";
      let m = t.match(/(\d+(?:\.\d+)?)\s*(?:\/|out of)\s*5/i) || t.match(/rated\s*(\d+(?:\.\d+)?)\s*stars?/i);
      if (m) { meta = Math.round(parseFloat(m[1])); return false; }
    });
    if (meta != null && meta >= 0 && meta <= 5) return meta;

    // 2) sprite/asset/class/filter heuristics on <img.star>
    const $stars = $cont.find("img.star");
    if ($stars.length) {
      let filled = 0, empty = 0;
      $stars.each(function () {
        const $img = $(this);
        const src = ($img.attr("src") || $img.attr("data-src") || "").toLowerCase();
        const cls = ($img.attr("class") || "").toLowerCase();
        const filter = (getComputedStyle(this).filter || "").toLowerCase();
        const opacity = parseFloat(getComputedStyle(this).opacity || "1");

        const looksEmpty = /gray|grey|empty|inactive|hollow|outline|off|muted|disabled|tb18/.test(src)
                        || /empty|off|inactive|hollow|outline/.test(cls)
                        || /grayscale\((1|100%)\)/.test(filter)
                        || opacity < 0.8;
        const looksFilled = /yellow|gold|full|active|filled|tb19/.test(src)
                         || /on|active|full|filled/.test(cls);

        if (looksEmpty && !looksFilled) empty++;
        else if (looksFilled && !looksEmpty) filled++;
        else {
          // ambiguous: default to filled for safety but we'll clamp later
          filled++;
        }
      });
      if (filled + empty === $stars.length) {
        return Math.max(0, Math.min(5, filled));
      }
    }

    // 3) width heuristic (rare fallback)
    try {
      const starW = $cont.find("img.star").get(0)?.getBoundingClientRect().width || 0;
      const totalW = $cont.get(0)?.getBoundingClientRect().width || 0;
      if (starW > 0 && totalW > 0) {
        const r = Math.round(totalW / starW);
        if (r >= 0 && r <= 5) return r;
      }
    } catch {}

    return null;
  }

  // Review images
  function extractImages($it) {
    const urls = new Set();
    $it.find("img").each(function () {
      const $img = $(this);
      if ($img.closest(".container-star").length) return;
      if ($img.hasClass("verifyImg") || $img.hasClass("lazadaicon") || $img.hasClass("star")) return;
      const candidates = [
        $img.attr("src"),
        $img.attr("data-src"),
        $img.attr("data-ks-lazyload"),
        $img.attr("data-original"),
      ].filter(Boolean);
      for (const c of candidates) {
        const abs = toAbs(c);
        if (abs) urls.add(abs);
      }
    });
    $it.find("[style*='background-image']").each(function () {
      const m = ($(this).attr("style") || "").match(/url\(["']?(.*?)["']?\)/i);
      if (m && m[1]) {
        const abs = toAbs(m[1]);
        if (abs) urls.add(abs);
      }
    });
    return Array.from(urls);
  }

  function extractReviewsOnPage() {
    const rows = [];
    $(".mod-reviews .item").each(function () {
      const $it = $(this);
      const rating = extractRating($it); // <-- fixed
      const dateText = $it.find(".top .title.right").text().trim() || null;
      const user = $it.find(".middle > span:first").text().trim() || null;
      const verified = $it.find(".verify").length > 0;
      const content = ($it.find(".item-content .content").text() || "").replace(/\s+/g, " ").trim();
      const skuInfo = ($it.find(".item-content .skuInfo").text() || "").replace(/\s+/g, " ").trim();
      const likesText = $it.find(".bottom .left .left-content span").last().text().trim();
      const likes = likesText ? parseInt(likesText, 10) || 0 : 0;
      const images = extractImages($it);
      rows.push({ rating, date: dateText, user, verified, content, sku: skuInfo, likes, images });
    });
    return rows;
  }

  // CSV helpers
  function toCSV(rows) {
    const headers = ["rating","date","user","verified","content","sku","likes","images"];
    const esc = (v) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      const needs = /[",\n]/.test(s);
      const out = s.replace(/"/g, '""');
      return needs ? `"${out}"` : out;
    };
    const lines = [headers.join(",")];
    for (const r of rows) {
      const imagesJoined = (r.images && r.images.length) ? r.images.join(" | ") : "";
      lines.push([
        esc(r.rating),
        esc(r.date),
        esc(r.user),
        esc(r.verified),
        esc(r.content),
        esc(r.sku),
        esc(r.likes),
        esc(imagesJoined),
      ].join(","));
    }
    return lines.join("\n");
  }
  function downloadCSV(filename, csvText) {
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 0);
  }

  // Crawl
  const all = [];
  const seen = new Set();
  let pages = 0;

  while (true) {
    pages++;
    const cur = getCurrentPageNumber();
    const total = getTotalPages();
    console.log(`Scraping page ${cur ?? pages}${total ? ` of ~${total}` : ""}`);

    await randomDelay(250, 600); // after load, before scrape

    for (const r of extractReviewsOnPage()) {
      const key = [r.user, r.date, r.content].join("|");
      if (!seen.has(key)) {
        seen.add(key);
        all.push(r);
      }
    }

    if ((total != null && cur != null && cur >= total) || isNextDisabled()) break;
    if (MAX_PAGES != null && pages >= MAX_PAGES) break;

    await randomDelay(DELAY_MIN_MS, DELAY_MAX_MS); // before next page
    const moved = await clickNextAndWait();
    if (!moved) break;
  }

  console.log(`Done. Collected ${all.length} reviews across ${pages} page(s).`);
  console.table(all);
  console.log("JSON:", JSON.stringify(all, null, 2));

  const csv = toCSV(all);
  downloadCSV("reviews.csv", csv);
  console.log("CSV download triggered as reviews.csv");
})();
