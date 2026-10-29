import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const agent = 'GoodHolidayDeals/0.1';
type RobotRules = { isAllowed(url: string, agent?: string): boolean | undefined; getCrawlDelay(agent?: string): number | undefined };
const robotsParser = createRequire(import.meta.url)('robots-parser') as (url: string, body: string) => RobotRules;
const allowedHosts = new Set(['www.vola.ro', 'travelminit.ro', 'christiantour.ro', 'www.directbooking.ro',
  'www.momondo.ro', 'www.kiwi.com', 'www.ro.kayak.com', 'www.cheapflights.com', 'www.skyscanner.ro']);
const maxBytes = 3 * 1024 * 1024;
type Page = { html: string; url: string; checkedAt: string };
const pages = new Map<string, { expires: number; page: Page }>();
const rules = new Map<string, { expires: number; parser: RobotRules }>();
const inflight = new Map<string, Promise<Page>>();
// A single queue per origin enforces crawl spacing even across simultaneous user searches.
const queues = new Map<string, Promise<unknown>>();
const lastRequest = new Map<string, number>();

export function allowedUrl(input: string, base?: string) {
  const url = new URL(input, base);
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname) || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error('Source URL is outside the allowed hosts');
  }
  return url;
}

async function boundedBody(response: Response, signal: AbortSignal) {
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) throw new Error('Source response is too large');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > maxBytes) throw new Error('Source response is too large');
      chunks.push(part.value);
    }
  } catch (e) { await reader.cancel(); throw e; }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}

async function request(url: URL, signal: AbortSignal, spacing = 1500) {
  const origin = url.origin;
  const previous = queues.get(origin) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const wait = Math.max(0, (lastRequest.get(origin) ?? 0) + spacing - Date.now());
    if (wait) await delay(wait, undefined, { signal });
    signal.throwIfAborted();
    lastRequest.set(origin, Date.now());
    const response = await fetch(url, { redirect: 'manual', signal,
      headers: { 'User-Agent': agent, Accept: 'text/html,text/plain;q=0.9' } });
    const html = await boundedBody(response, signal);
    return { response, html };
  });
  queues.set(origin, next);
  return next;
}

async function robots(url: URL, signal: AbortSignal) {
  const cached = rules.get(url.origin);
  if (cached && cached.expires > Date.now()) return cached.parser;
  const robotsUrl = new URL('/robots.txt', url);
  const { response, html } = await request(robotsUrl, signal, 3000);
  if (response.status !== 404 && (!response.ok || /<html/i.test(html))) throw new Error('Source crawling rules are unavailable');
  const parser = robotsParser(robotsUrl.href, response.status === 404 ? '' : html);
  rules.set(url.origin, { parser, expires: Date.now() + 6 * 3600_000 });
  return parser;
}

export function clearSourceCache() { pages.clear(); rules.clear(); }

export async function publicPage(input: string, signal: AbortSignal): Promise<Page> {
  const first = allowedUrl(input);
  const cached = pages.get(first.href);
  if (cached && cached.expires > Date.now()) return cached.page;
  const existing = inflight.get(first.href);
  if (existing) return existing;
  const pending = (async () => {
    let url = first;
    for (let redirects = 0; redirects <= 3; redirects++) {
      const policy = await robots(url, signal);
      if (policy.isAllowed(url.href, agent) === false) throw new Error('Source crawling rules exclude this page');
      const { response, html } = await request(url, signal, Math.max(1500, (policy.getCrawlDelay(agent) ?? 0) * 1000));
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error('Source redirect is invalid');
        const target = allowedUrl(location, url.href);
        if (target.origin !== first.origin) throw new Error('Cross-origin source redirect is not allowed');
        url = target; continue;
      }
      if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
      if (!response.headers.get('content-type')?.includes('text/html')) throw new Error('Source did not return an HTML page');
      const page = { html, url: url.href, checkedAt: new Date().toISOString() };
      pages.set(first.href, { page, expires: Date.now() + 30 * 60_000 });
      return page;
    }
    throw new Error('Too many source redirects');
  })();
  inflight.set(first.href, pending);
  try { return await pending; } finally { inflight.delete(first.href); }
}
