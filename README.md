# DataDog Asset Retriever

> **Note:** This project has mostly been written by [Cursor](https://cursor.com).

A **Chrome** and **Firefox** extension that runs on Datadog **monitor list** or **dashboard list** pages and exports a CSV with:

| Column | Description |
|--------|-------------|
| **Name** | Display name of the monitor or dashboard |
| **URL** | Full URL to the monitor or dashboard |
| **Query** | Alert/query string (monitors only; empty for dashboards) |

## Supported pages

- **Monitors:** [Manage Monitors](https://app.datadoghq.com/monitors/manage) and [Triggered Monitors](https://app.datadoghq.com/monitors/triggered)
- **Dashboards:** [Dashboard List](https://app.datadoghq.com/dashboard/lists)

Works with `*.datadoghq.com` and `*.ddog-gov.com` (e.g. US1, EU, GovCloud).

## Install

### Chrome

1. Open `chrome://extensions/`
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Select the `datadog-exporter` folder

### Firefox

1. Open `about:debugging`
2. Click **This Firefox** → **Load Temporary Add-on**
3. Select `manifest.json` inside the `datadog-exporter` folder  

For a permanent install: package the extension (e.g. zip the folder) and use **about:addons** → **Install Add-on From File**, or sign it for AMO.

## Usage

### Mode 1: Export from a list page

1. In your browser, open a Datadog **Monitor list** or **Dashboard list** page and wait for the list to load (scroll if it’s infinite so all items are in the DOM).
2. Click the extension icon in the toolbar.
3. Click **Export to CSV**.
4. A file like `datadog-monitors-2025-03-12.csv` or `datadog-dashboards-2025-03-12.csv` will download.

### Mode 2: URL list → names CSV

When you open the extension on a page that **isn’t** Datadog, the popup shows a text area instead.

1. Paste a list of Datadog URLs (one per line). URLs without a scheme (e.g. `app.datadoghq.com/…`) are treated as `https://`.
2. Click **Fetch titles & export CSV**.
3. The extension opens each URL in a background tab, reads the page name (from the tab title), then closes the tab and builds a CSV with columns **URL** (full URL with scheme) and **Name** (e.g. `datadog-urls-names-2025-03-12.csv`).

If any URL fails to load (network error, timeout, or invalid/non-Datadog URL), the extension **aborts** and shows an error; no CSV is written for that run. Only Datadog URLs (`*.datadoghq.com`, `*.datadoghq.eu`, `*.ddog-gov.com`) are accepted. The “name” is the browser tab title for each page.

## If the page isn’t detected or no items are found

1. Reload the Datadog list page, then click the extension again.
2. **Check if the extension ran:** In DevTools → Console run:
   ```js
   document.documentElement.getAttribute('data-datadog-exporter-loaded')
   ```
   If this is `null`, the content script didn’t load (wrong URL, host not in manifest, or extension not allowed on that site).
3. **Inspect what the exporter sees:** In the same tab’s console run (it returns a Promise, so use `await` or `.then()`):
   ```js
   await __datadogExporter.debug()
   ```
   or
   ```js
   __datadogExporter.debug().then(console.log)
   ```
   You’ll see whether the page is recognized, how many links were found, and a few sample links. Sharing that output (or a screenshot) helps tune detection.

## Query column (monitors)

The extension tries to read the **query** from the same table row as the monitor (e.g. a “Query” or “Metric” column if the UI shows it). If your Datadog UI doesn’t show the query on the list page, the Query column will be empty. In that case you can:

- Open each monitor and copy the query from the edit page, or  
- Use the [Datadog Monitors API](https://docs.datadoghq.com/api/latest/monitors/) to fetch query definitions (e.g. with an API key in a separate script).

Dashboards don’t have a single “alert query”, so the Query column is left empty for dashboard exports.

## Files

- `manifest.json` – Extension manifest (Manifest V3)
- `content.js` – Runs on Datadog list pages; collects links and optional query text
- `popup.html` / `popup.js` – Toolbar popup with “Export to CSV”
- `icons/` – Toolbar icons (16×16, 48×48)

## License

2-clause BSD. See [LICENSE](LICENSE).
