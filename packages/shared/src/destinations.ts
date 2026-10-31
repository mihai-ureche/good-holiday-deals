// ISO 3166-1 countries; names come from the runtime's CLDR data (English/Romanian).
const codes = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const english = new Intl.DisplayNames(['en'], { type: 'region' });
const romanian = new Intl.DisplayNames(['ro'], { type: 'region' });
export const destinationCountries = codes.map(code => ({ code, name: english.of(code)! }))
  .sort((a, b) => a.name.localeCompare(b.name, 'en'));
const countries = new Map<string, string>();
for (const code of codes) for (const name of [code, english.of(code)!, romanian.of(code)!]) countries.set(normalize(name), code);
for (const [name, code] of Object.entries({ turkey: 'TR', turkiye: 'TR', uk: 'GB', britain: 'GB',
  'great britain': 'GB', usa: 'US', 'united states of america': 'US', uae: 'AE', 'czech republic': 'CZ', holland: 'NL' })) countries.set(name, code);
export const countryCode = (value: string) => countries.get(normalize(value));
export const countryName = (value: string) => english.of(countryCode(value) ?? 'ZZ') ?? value;

// Catalog of common destinations in the public travel feeds. City-only destinations
// outside this catalog are excluded from country-filtered results.
// Extend with explicit aliases as sources add destinations; never infer from an origin,
// hotel title or booking URL. Country names in the destination take priority.
const cityGroups: [string, string][] = [
  ['IT', 'Rome|Roma;Venice|Venezia|Venetia;Milan|Milano;Naples|Napoli;Florence|Firenze|Florenta;Bologna;Bari;Catania;Palermo;Sicily|Sicilia;Sardinia|Sardegna;Rimini;Turin|Torino'],
  ['GR', 'Athens|Atena;Thessaloniki|Salonic;Crete|Creta;Rhodes|Rodos;Corfu;Zakynthos|Zante;Santorini;Mykonos;Kos;Halkidiki|Chalkidiki;Heraklion;Chania;Thassos|Tasos'],
  ['ES', 'Madrid;Barcelona;Valencia;Malaga;Alicante;Seville|Sevilla;Palma de Mallorca|Palma;Mallorca|Majorca;Menorca;Ibiza;Tenerife;Gran Canaria;Lanzarote;Fuerteventura;Costa Brava;Costa del Sol'],
  ['TR', 'Istanbul;Antalya;Alanya;Bodrum;Dalaman;Marmaris;Kemer;Belek;Kusadasi;Side;Izmir'],
  ['EG', 'Hurghada;Sharm el Sheikh|Sharm el Sheik|Sharm ash Shaykh;Cairo;Marsa Alam;Luxor'],
  ['RO', 'Bucharest|Bucuresti|Otopeni;Cluj|Cluj Napoca;Iasi;Timisoara;Brasov;Sibiu;Constanta;Mamaia;Eforie Nord;Eforie Sud;Sinaia;Busteni;Predeal;Sovata;Oradea'],
  ['BG', 'Sofia;Varna;Burgas;Sunny Beach|Slanchev Bryag;Golden Sands|Nisipurile de Aur;Albena;Bansko;Nessebar|Nesebar;Balchik'],
  ['FR', 'Paris|Parigi;Nice|Nisa;Marseille|Marsilia;Lyon;Bordeaux;Toulouse;Cannes;Strasbourg'],
  ['PT', 'Lisbon|Lisboa|Lisabona;Porto;Faro;Madeira;Funchal;Algarve;Azores|Azore'],
  ['GB', 'London|Londra;Manchester;Edinburgh;Birmingham;Liverpool;Bristol'],
  ['DE', 'Berlin;Munich|Munchen;Frankfurt;Hamburg;Dortmund;Cologne|Koln;Dusseldorf'],
  ['AT', 'Vienna|Viena|Wien;Salzburg;Innsbruck'], ['HU', 'Budapest|Budapesta;Debrecen'],
  ['CZ', 'Prague|Praga|Praha'], ['NL', 'Amsterdam;Eindhoven;Rotterdam'], ['BE', 'Brussels|Bruxelles;Charleroi'],
  ['CY', 'Larnaca;Paphos|Pafos;Ayia Napa;Limassol'], ['MT', 'Valletta;St Julians;Sliema;Gozo;Luqa;Qawra'],
  ['HR', 'Dubrovnik;Split;Zagreb;Zadar;Pula'], ['ME', 'Podgorica;Tivat;Budva;Kotor'],
  ['AL', 'Tirana;Sarande|Saranda;Durres;Vlore'], ['TN', 'Tunis;Hammamet;Sousse;Djerba;Monastir'],
  ['MA', 'Marrakech|Marrakesh;Agadir;Casablanca;Fes'], ['AE', 'Dubai;Abu Dhabi;Ras al Khaimah;Sharjah'],
  ['TH', 'Bangkok;Phuket;Krabi;Koh Samui;Chiang Mai'], ['ID', 'Bali;Denpasar;Jakarta'],
  ['MV', 'Male'], ['MU', 'Mauritius'], ['SC', 'Mahe'], ['TZ', 'Zanzibar'],
  ['US', 'New York|New York City;Miami;Las Vegas;Los Angeles;San Francisco;Orlando'],
  ['MX', 'Cancun;Riviera Maya;Playa del Carmen'], ['DO', 'Punta Cana'], ['CU', 'Havana;Varadero'],
];
const majorCities = new Map(cityGroups.map(([country, groups]) => [country,
  groups.split(';').slice(0, 5).map(group => group.split('|')[0]!.trim())]));
const countryCities = new Map(cityGroups.map(([country, groups]) => [country,
  groups.split(';').map(group => group.split('|')[0]!.trim())]));
export const flightDestinationCountries = [...majorCities.keys()].map(code => ({ code, name: english.of(code)! }))
  .sort((a, b) => a.name.localeCompare(b.name, 'en'));
export function defaultTargetCities(country: string): string[] {
  return [...(majorCities.get(countryCode(country) ?? '') ?? [])];
}
export function targetCityOptions(country: string): string[] {
  return [...(countryCities.get(countryCode(country) ?? '') ?? [])];
}
export function selectedTargetCities(target: { targetCountry?: string; targetCities?: string[] }): string[] {
  return target.targetCities?.map(value => value.trim()).filter(Boolean) ?? [];
}
const cities = new Map<string, { key: string; country: string }>();
for (const [country, groups] of cityGroups) for (const group of groups.split(';')) {
  const aliases = group.split('|').map(normalize);
  for (const alias of aliases) cities.set(alias, { key: aliases[0]!, country });
}
export const destinationKey = (value: string) => cities.get(normalize(value))?.key ?? normalize(value);

type Destination = { destination: string; destinationCountry?: string };
type Target = { targetCities?: string[]; targetCountry?: string };
export function matchesDestination(criteria: Target, offer: Destination): boolean {
  const country = criteria.targetCountry?.trim();
  const targetCities = selectedTargetCities(criteria);
  if (!targetCities.length && !country) return true;
  // Separators distinguish a city from an explicit region/country. Whole-place
  // comparisons prevent e.g. Rome matching Romeoville or York matching New York.
  const parts = offer.destination.split(/[,;/\n()]+|\s+[-–—]\s+/).map(normalize).filter(Boolean);
  const namedCountries = parts.map(countryCode).filter((code): code is string => !!code);
  const explicitCountry = offer.destinationCountry ? countryCode(offer.destinationCountry) : undefined;
  if (country && offer.destinationCountry && !explicitCountry) return false;
  const knownCountries = explicitCountry ? [explicitCountry] : namedCountries.length ? namedCountries
    : parts.flatMap(part => cities.get(part)?.country ?? []);
  if (country && (!countryCode(country) || !knownCountries.length
    || !knownCountries.every(code => code === countryCode(country)))) return false;
  if (targetCities.length && !targetCities.some(city => parts.some(part => !countryCode(part)
    && destinationKey(part) === destinationKey(city)))) return false;
  return true;
}
