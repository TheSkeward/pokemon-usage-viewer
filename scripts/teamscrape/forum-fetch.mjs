/**
 * @fileoverview Polite text fetcher for public team sources. GitHub Actions
 * can opt into a real, unmodified headless Chrome session for Smogon forum
 * pages via SMOGON_FETCH_MODE=browser; other hosts keep using Node fetch.
 * The browser context is shared for the scraper's lifetime so cookies and
 * normal navigation state survive between requests.
 */

const USER_AGENT =
  'pokemon-usage-viewer team harvester ' +
  '(github.com/TheSkeward/pokemon-usage-viewer)';
const CONTACT = 'https://github.com/TheSkeward/pokemon-usage-viewer';
const DEFAULT_REQUEST_GAP_MS = 1500;
const NAVIGATION_TIMEOUT_MS = 45000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class HttpStatusError extends Error {
  constructor(status, url) {
    super(`${status} ${url}`);
    this.status = status;
  }
}

/** @param {string} url @return {boolean} */
export function isSmogonForumUrl(url) {
  const parsed = new URL(url);
  return parsed.hostname === 'www.smogon.com' &&
    parsed.pathname.startsWith('/forums/');
}

/** @return {!Promise<!Object>} A Playwright Browser. */
async function launchChrome() {
  const { chromium } = await import('playwright-core');
  const executablePath = process.env.SMOGON_CHROME_PATH;
  const options = {
    headless: true,
    args: ['--disable-dev-shm-usage'],
  };
  if (executablePath) options.executablePath = executablePath;
  else options.channel = 'chrome';
  return chromium.launch(options);
}

/**
 * @param {!Object=} options Injectable seams are used by unit tests.
 * @return {{fetchText: function(string): !Promise<string>,
 *     close: function(): !Promise<void>}}
 */
export function createForumFetcher(options = {}) {
  const mode = options.mode ?? process.env.SMOGON_FETCH_MODE ?? 'http';
  if (!['http', 'browser'].includes(mode)) {
    throw new Error(`unknown SMOGON_FETCH_MODE ${JSON.stringify(mode)}`);
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const launchBrowser = options.launchBrowser ?? launchChrome;
  const wait = options.sleepImpl ?? sleep;
  const now = options.now ?? Date.now;
  const requestGapMs = options.requestGapMs ??
    Number(process.env.SMOGON_REQUEST_GAP_MS || DEFAULT_REQUEST_GAP_MS);
  let lastRequestAt = 0;
  let browserPromise = null;
  let contextPromise = null;
  let smogonBlocked = null;

  async function throttle() {
    const remaining = lastRequestAt + requestGapMs - now();
    if (remaining > 0) await wait(remaining);
    lastRequestAt = now();
  }

  async function getBrowserContext() {
    if (!browserPromise) browserPromise = launchBrowser();
    if (!contextPromise) {
      contextPromise = browserPromise.then(async (browser) => {
        const context = await browser.newContext({
          extraHTTPHeaders: { From: CONTACT },
          serviceWorkers: 'block',
        });
        await context.route('**/*', async (route) => {
          const request = route.request();
          const hostname = new URL(request.url()).hostname;
          if (hostname !== 'www.smogon.com') return route.abort();
          // Bandwidth courtesy: the parser reads documents only. CSS/JS
          // still load so the session stays browser-shaped; images, media,
          // and fonts are the fan-out bulk and feed nothing.
          if (['image', 'media', 'font'].includes(request.resourceType())) {
            return route.abort();
          }
          return route.continue();
        });
        return context;
      });
    }
    return contextPromise;
  }

  async function fetchWithBrowser(url) {
    const context = await getBrowserContext();
    const page = await context.newPage();
    try {
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT_MS,
      });
      if (!response) throw new Error(`no HTTP response ${url}`);
      const status = response.status();
      const finalUrl = response.url();
      if (status < 200 || status >= 300) {
        throw new HttpStatusError(status, finalUrl);
      }
      return response.text();
    } finally {
      await page.close();
    }
  }

  async function fetchWithHttp(url) {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'text/html,text/plain;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': USER_AGENT,
      },
    });
    if (!response.ok) throw new HttpStatusError(response.status, url);
    return response.text();
  }

  async function fetchText(url) {
    const smogon = isSmogonForumUrl(url);
    if (smogonBlocked && smogon) {
      throw new Error(`Smogon requests paused after ${smogonBlocked.message}`);
    }
    await throttle();
    try {
      if (mode === 'browser' && smogon) return await fetchWithBrowser(url);
      return await fetchWithHttp(url);
    } catch (error) {
      // A blanket 403 should stop this process from hammering every configured
      // thread. The next scheduled run starts with a fresh session and may
      // try once again.
      if (smogon && error.status === 403) smogonBlocked = error;
      throw error;
    }
  }

  async function close() {
    const context = contextPromise ? await contextPromise : null;
    if (context) await context.close();
    const browser = browserPromise ? await browserPromise : null;
    if (browser) await browser.close();
    contextPromise = null;
    browserPromise = null;
  }

  return { fetchText, close };
}

const defaultFetcher = createForumFetcher();
export const fetchTeamSourceText = defaultFetcher.fetchText;
export const closeTeamSourceFetcher = defaultFetcher.close;
