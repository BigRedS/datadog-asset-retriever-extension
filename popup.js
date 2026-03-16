const countsEl = document.getElementById('counts');
const msgEl = document.getElementById('message');
const modeDatadogPage = document.getElementById('mode-datadog-page');
const modeUrlList = document.getElementById('mode-url-list');
const urlListTextarea = document.getElementById('url-list');
const fetchTitlesBtn = document.getElementById('fetch-titles');

function isDatadogUrl(url) {
  return /datadoghq\.(com|eu)|ddog-gov\.com/.test(url || '');
}

function setMode(isDatadog) {
  if (isDatadog) {
    modeDatadogPage.style.display = '';
    modeUrlList.style.display = 'none';
  } else {
    modeDatadogPage.style.display = 'none';
    modeUrlList.style.display = '';
  }
}

async function updateCounts() {
  countsEl.textContent = '';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !isDatadogUrl(tab.url)) {
      countsEl.textContent = 'Open a Datadog page to see counts.';
      return;
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (typeof window.__datadogExporter !== 'undefined' && window.__datadogExporter.getExportCounts) {
          return window.__datadogExporter.getExportCounts();
        }
        return null;
      },
    });
    const counts = results?.[0]?.result;
    if (!counts) {
      countsEl.textContent = 'Reload the Datadog page to see counts.';
      return;
    }
    if (counts.pageType === 'monitors') {
      countsEl.textContent = `Monitor links: ${counts.monitorCount}`;
    } else if (counts.pageType === 'dashboards') {
      countsEl.textContent = `Dashboard links: ${counts.dashboardCount}`;
    } else {
      countsEl.textContent = 'Open a monitor list or dashboard list page to see counts.';
    }
  } catch (_) {
    countsEl.textContent = 'Could not get counts.';
  }
}

async function initMode() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const onDatadog = !!(tab?.url && isDatadogUrl(tab.url));
  setMode(onDatadog);
  if (onDatadog) updateCounts();
}

initMode();

document.getElementById('export').addEventListener('click', async () => {
  const btn = document.getElementById('export');
  msgEl.className = '';
  msgEl.textContent = '';
  btn.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      msgEl.className = 'error';
      msgEl.textContent = 'No active tab.';
      return;
    }
    if (!isDatadogUrl(tab.url)) {
      msgEl.className = 'error';
      msgEl.textContent = 'Open a Datadog monitor list or dashboard list page first.';
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (typeof window.__datadogExporter !== 'undefined') {
          return window.__datadogExporter.runExport();
        }
        return { ok: false, error: 'Page not ready. Reload the Datadog page and try again.' };
      },
    });

    const result = results?.[0]?.result;
    if (!result) {
      msgEl.className = 'error';
      msgEl.textContent = 'Could not run export. Reload the Datadog page and try again.';
      return;
    }
    if (!result.ok) {
      msgEl.className = 'error';
      msgEl.textContent = result.error || 'Export failed.';
      return;
    }
    msgEl.className = 'success';
    msgEl.textContent = `Exported ${result.count} ${result.pageType}. Saved as ${result.filename}.`;
    updateCounts();
  } catch (e) {
    msgEl.className = 'error';
    msgEl.textContent = e.message || 'Export failed.';
  } finally {
    btn.disabled = false;
  }
});

// --- URL list mode: fetch name for each Datadog URL, export CSV; abort on first failure ---

function parseUrlLines(text) {
  return text.split(/\n/).map((s) => s.trim()).filter(Boolean);
}

/** Ensure URL has a scheme so we always store full URLs (e.g. https://). */
function normalizeUrl(url) {
  const s = (url || '').trim();
  if (!s) return s;
  if (/^https?:\/\//i.test(s)) return s;
  return 'https://' + s.replace(/^\/+/, '');
}

function waitForTabLoad(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const listener = (id, info, tab) => {
      if (id !== tabId) return;
      if (info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        chrome.tabs.get(id).then((t) => {
          const u = (t.url || '').toLowerCase();
          if (u.startsWith('chrome-error:') || u.startsWith('about:neterror') || u.startsWith('edge-error:')) {
            reject(new Error('Page failed to load: ' + (t.url || id)));
          } else {
            resolve({ name: t.title ?? '', url: t.url ?? '' });
          }
        }).catch(reject);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.tabs.get(tabId).catch(() => {});
      reject(new Error('Page load timed out'));
    }, timeoutMs);
  });
}

function escapeCsvCell(value) {
  if (value == null || value === '') return '';
  const s = String(value).trim();
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function downloadCsvFromPopup(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

fetchTitlesBtn.addEventListener('click', async () => {
  msgEl.className = '';
  msgEl.textContent = '';
  fetchTitlesBtn.disabled = true;

  try {
    const lines = parseUrlLines(urlListTextarea.value);
    if (lines.length === 0) {
      msgEl.className = 'error';
      msgEl.textContent = 'Enter at least one URL (one per line).';
      return;
    }
    const normalizedLines = lines.map((line) => normalizeUrl(line));
    for (const url of normalizedLines) {
      try {
        new URL(url);
      } catch {
        msgEl.className = 'error';
        msgEl.textContent = 'Invalid URL: ' + url.slice(0, 60) + (url.length > 60 ? '…' : '');
        return;
      }
      if (!isDatadogUrl(url)) {
        msgEl.className = 'error';
        msgEl.textContent = 'Not a Datadog URL: ' + url.slice(0, 60) + (url.length > 60 ? '…' : '');
        return;
      }
    }

    const rows = [];
    for (let i = 0; i < normalizedLines.length; i++) {
      const inputUrl = normalizedLines[i];
      msgEl.textContent = `Loading ${i + 1}/${normalizedLines.length}…`;
      const tab = await chrome.tabs.create({ url: inputUrl, active: false });
      try {
        const { name, url: finalUrl } = await waitForTabLoad(tab.id);
        rows.push({ url: finalUrl || inputUrl, name });
      } finally {
        await chrome.tabs.remove(tab.id).catch(() => {});
      }
    }

    const header = 'URL,Name';
    const csv = [header, ...rows.map((r) => [escapeCsvCell(r.url), escapeCsvCell(r.name)].join(','))].join('\r\n');
    const date = new Date().toISOString().slice(0, 10);
    downloadCsvFromPopup(csv, `datadog-urls-names-${date}.csv`);
    msgEl.className = 'success';
    msgEl.textContent = `Exported ${rows.length} URLs. Saved as datadog-urls-names-${date}.csv`;
  } catch (e) {
    msgEl.className = 'error';
    msgEl.textContent = e.message || 'Failed to fetch titles.';
  } finally {
    fetchTitlesBtn.disabled = false;
  }
});
