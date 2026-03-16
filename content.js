/**
 * Datadog Exporter - Content script
 * Scrapes monitor list or dashboard list and exports Name, URL, Query to CSV.
 */

(function () {
  'use strict';

  const MONITOR_LIST_PATH = '/monitors/manage';
  const MONITOR_TRIGGERED_PATH = '/monitors/triggered';
  const DASHBOARD_LIST_PATH = '/dashboard/lists';

  function isMonitorListPage() {
    const path = window.location.pathname;
    return path.startsWith('/monitors/manage') || path.startsWith('/monitors/triggered');
  }

  function isDashboardListPage() {
    return window.location.pathname.startsWith('/dashboard/lists') || window.location.pathname === '/dashboard';
  }

  function getBaseUrl() {
    return window.location.origin;
  }

  function escapeCsvCell(value) {
    if (value == null || value === '') return '';
    const s = String(value).trim();
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // Only /monitors/<numeric_id> with nothing after the ID (no query, no extra path)
  function isMonitorDetailPath(pathname) {
    return /^\/monitors\/\d+$/.test(pathname || '');
  }

  function queryAllRoots(selector) {
    const out = [];
    function walk(root) {
      try {
        out.push(...root.querySelectorAll(selector));
        root.querySelectorAll('*').forEach((el) => {
          if (el.shadowRoot) walk(el.shadowRoot);
        });
      } catch (_) {}
    }
    walk(document);
    return out;
  }

  function collectMonitors() {
    const baseUrl = getBaseUrl();
    const rows = [];
    const seenUrls = new Set();

    // Find all links to a monitor (any ID format); search document and shadow roots
    const monitorLinks = queryAllRoots('a[href*="/monitors/"]');
    for (const a of monitorLinks) {
      const href = (a.getAttribute('href') || '').trim();
      if (!href) continue;
      const fullUrl = href.startsWith('http') ? href : baseUrl + (href.startsWith('/') ? href : '/' + href);
      let pathname;
      try {
        pathname = new URL(fullUrl).pathname;
      } catch {
        continue;
      }
      if (!isMonitorDetailPath(pathname) || seenUrls.has(pathname)) continue;
      seenUrls.add(pathname);
      const cleanUrl = baseUrl + pathname;

      const name = (a.textContent || '').trim() || a.getAttribute('aria-label') || 'Unnamed';
      rows.push({ name, url: cleanUrl, query: '' });
    }

    return rows;
  }

  function collectDashboards() {
    const baseUrl = getBaseUrl();
    const rows = [];
    const seenUrls = new Set();
    const skipPathPrefixes = ['/dashboard/lists/', '/dashboard/shared'];

    const dashboardLinks = queryAllRoots('a[href*="/dashboard/"]');
    for (const a of dashboardLinks) {
      const href = (a.getAttribute('href') || '').trim();
      if (!href) continue;
      const fullUrl = href.startsWith('http') ? href : baseUrl + (href.startsWith('/') ? href : '/' + href);
      let pathname;
      try {
        pathname = new URL(fullUrl).pathname;
      } catch {
        continue;
      }
      // Skip list pages, shared links, and create
      if (skipPathPrefixes.some((p) => pathname.startsWith(p))) continue;
      if (pathname.startsWith('/dashboard/create')) continue;
      if (!pathname.match(/\/dashboard\/[^/]+/)) continue;
      if (seenUrls.has(fullUrl)) continue;
      seenUrls.add(fullUrl);

      let name = (a.textContent || '').trim() || a.getAttribute('aria-label') || '';
      const isGenericName = /^Row Action$/i.test(name) || /^Action$/i.test(name) || !name;
      if (isGenericName) {
        const row = a.closest('tr') || a.closest('[role="row"]') || a.closest('li');
        if (row) {
          const rowLinks = row.querySelectorAll('a[href*="/dashboard/"]');
          for (const other of rowLinks) {
            const otherHref = (other.getAttribute('href') || '').trim();
            const otherUrl = otherHref.startsWith('http') ? otherHref : baseUrl + (otherHref.startsWith('/') ? otherHref : '/' + otherHref);
            let otherPath;
            try {
              otherPath = new URL(otherUrl).pathname;
            } catch {
              continue;
            }
            if (otherPath !== pathname) continue;
            const otherText = (other.textContent || '').trim();
            if (otherText && !/^Row Action$/i.test(otherText) && !/^Action$/i.test(otherText)) {
              name = otherText;
              break;
            }
          }
          if (!name) {
            const firstCell = row.querySelector('td, [role="cell"], [class*="TableCell"]');
            const cellText = firstCell ? (firstCell.textContent || '').trim() : '';
            if (cellText && !/^Row Action$/i.test(cellText)) name = cellText;
          }
          if (!name && row.textContent) {
            const parts = (row.textContent || '').trim().split(/\s+/).filter((s) => s.length > 2);
            const bad = new Set(['Row', 'Action', 'Star', 'Modified', 'Popularity', 'Author', 'Teams']);
            const candidate = parts.find((p) => !bad.has(p));
            if (candidate) name = candidate;
          }
        }
      }
      rows.push({ name: name || 'Unnamed', url: fullUrl, query: '' });
    }

    return rows;
  }

  function exportToCsv(rows) {
    const header = 'Name,URL,Query';
    const lines = [header, ...rows.map(r => [escapeCsvCell(r.name), escapeCsvCell(r.url), escapeCsvCell(r.query)].join(','))];
    return lines.join('\r\n');
  }

  function downloadCsv(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function runExport() {
    let rows = [];
    let pageType = '';

    if (isMonitorListPage()) {
      rows = collectMonitors();
      pageType = 'monitors';
    } else if (isDashboardListPage()) {
      rows = collectDashboards();
      pageType = 'dashboards';
    } else {
      return { ok: false, error: 'This page is not a Datadog monitor list or dashboard list. Open Monitors → Manage Monitors or Dashboard → Dashboard List and try again.' };
    }

    if (rows.length === 0) {
      return { ok: false, error: 'No items found. Make sure the list has loaded (scroll if it loads more as you scroll) and try again.' };
    }

    const csv = exportToCsv(rows);
    const date = new Date().toISOString().slice(0, 10);
    const filename = `datadog-${pageType}-${date}.csv`;
    downloadCsv(csv, filename);
    return { ok: true, count: rows.length, filename, pageType };
  }

  function debug() {
    const isMonitor = isMonitorListPage();
    const isDashboard = isDashboardListPage();
    const links = isMonitor ? queryAllRoots('a[href*="/monitors/"]') : queryAllRoots('a[href*="/dashboard/"]');
    const sample = Array.from(links).slice(0, 5).map((a) => ({
      href: a.getAttribute('href'),
      text: (a.textContent || '').trim().slice(0, 60),
    }));
    return {
      page: isMonitor ? 'monitor list' : isDashboard ? 'dashboard list' : 'unknown',
      pathname: window.location.pathname,
      linkCount: links.length,
      sample,
    };
  }

  function getExportCounts() {
    const path = window.location.pathname || '';
    if (path.includes('/monitors')) {
      return { pageType: 'monitors', monitorCount: collectMonitors().length, dashboardCount: 0 };
    }
    if (path.includes('/dashboard')) {
      return { pageType: 'dashboards', monitorCount: 0, dashboardCount: collectDashboards().length };
    }
    return { pageType: null, monitorCount: 0, dashboardCount: 0 };
  }

  // Expose in content script context (used by popup via executeScript)
  window.__datadogExporter = { runExport, isMonitorListPage, isDashboardListPage, getExportCounts, debug };

  // Mark that we ran (same DOM in both contexts – check in console: document.documentElement.getAttribute('data-datadog-exporter-loaded'))
  document.documentElement.setAttribute('data-datadog-exporter-loaded', 'true');

  // Inject bridge into page context so the console (page context) can call __datadogExporter.debug()
  const script = document.createElement('script');
  script.textContent = `
(function() {
  window.__datadogExporter = {
    debug: function() {
      return new Promise(function(resolve) {
        function onResult(e) {
          document.removeEventListener('datadog-exporter-debug-result', onResult);
          resolve(e.detail);
        }
        document.addEventListener('datadog-exporter-debug-result', onResult);
        document.dispatchEvent(new CustomEvent('datadog-exporter-debug'));
      });
    }
  };
})();
`;
  (document.head || document.documentElement).appendChild(script);
  script.remove();

  document.addEventListener('datadog-exporter-debug', function() {
    try {
      const result = debug();
      document.dispatchEvent(new CustomEvent('datadog-exporter-debug-result', { detail: result }));
    } catch (e) {
      document.dispatchEvent(new CustomEvent('datadog-exporter-debug-result', { detail: { error: String(e.message || e) } }));
    }
  });
})();
