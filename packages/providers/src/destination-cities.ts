import { countryCode, targetCityOptions } from '../../shared/src/destinations.js';

const endpoint = 'https://countries.dev/cities';
const cache = new Map<string, { expiresAt: number; cities: string[] }>();
const cacheTtlMs = 24 * 60 * 60 * 1000;

type CityRecord = { name?: unknown; countryCode?: unknown; population?: unknown };

export async function destinationCities(country: string, request: typeof fetch = fetch,
  signal: AbortSignal = AbortSignal.timeout(8_000)): Promise<string[]> {
  const code = countryCode(country);
  if (!code) throw new Error('Choose a valid destination country');
  const cached = cache.get(code);
  if (cached && cached.expiresAt > Date.now()) return [...cached.cities];

  const fallback = targetCityOptions(code);
  try {
    const response = await request(`${endpoint}?country=${encodeURIComponent(code)}&limit=25`, {
      signal, headers: { Accept: 'application/json' }, redirect: 'error',
    });
    if (!response.ok) throw new Error(`City directory returned HTTP ${response.status}`);
    const body: unknown = await response.json();
    if (!Array.isArray(body)) throw new Error('City directory returned an invalid response');
    const cities = body
      .filter((value): value is CityRecord => !!value && typeof value === 'object')
      .filter(value => typeof value.name === 'string' && value.countryCode === code)
      .sort((a, b) => Number(b.population ?? 0) - Number(a.population ?? 0))
      .map(value => String(value.name).trim()).filter(Boolean)
      .filter((value, index, values) => values.findIndex(other => other.toLocaleLowerCase() === value.toLocaleLowerCase()) === index)
      .slice(0, 25);
    if (!cities.length) throw new Error('No cities are available for this country');
    cache.set(code, { expiresAt: Date.now() + cacheTtlMs, cities });
    return [...cities];
  } catch (error) {
    if (fallback.length) return fallback;
    throw error;
  }
}

export async function majorDestinationCities(country: string, request: typeof fetch = fetch,
  signal?: AbortSignal): Promise<string[]> {
  const cities = await destinationCities(country, request, signal);
  return cities.slice(0, 5);
}

export function clearDestinationCityCache() {
  cache.clear();
}
