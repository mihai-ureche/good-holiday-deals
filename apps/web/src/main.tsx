import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { money, isSpecificOffer, searchSchema, type Offer, type SavedSearch, type SearchCriteria } from '../../../packages/shared/src/index.js';
import './style.css';
import './sources.css';
import './trips.css';
import './destinations.css';
import { TripResults, type ListedTrip } from './TripResults.js';
import { countryCode, countryName, destinationCountries,
  selectedTargetCities } from '../../../packages/shared/src/destinations.js';
import { OfferDetails } from './OfferDetails.js';
import { MessageModal } from './MessageModal.js';
import { api } from './api.js';
import { FlightResults } from './FlightResults.js';

type Me = { email: string; digestEnabled: boolean; timezone: string; emailConfigured: boolean; liveFlightPricing: boolean; liveStayPricing: boolean; providers: string[];
  sources: { id: string; name: string; url: string; mode: string; detail: string }[] };
type Search = SavedSearch & { lastCheckedAt: string | null; lastStatus: string | null };
type ListedOffer = Offer & { searchId: string; searchName: string };
function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [searches, setSearches] = useState<Search[]>([]);
  const [offers, setOffers] = useState<ListedOffer[]>([]);
  const [trips, setTrips] = useState<ListedTrip[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Search | null>(null);
  const [currency, setCurrency] = useState('EUR');
  const [sort, setSort] = useState('asc');
  const [type, setType] = useState('all');
  const [searchId, setSearchId] = useState('all');
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [selectedOffer, setSelectedOffer] = useState<(Offer & { searchId?: string }) | null>(null);

  async function refresh() {
    const [account, saved, found, combinations] = await Promise.all([api<Me>('/me'), api<Search[]>('/searches'), api<ListedOffer[]>('/offers'), api<ListedTrip[]>('/trips')]);
    setMe(account); setSearches(saved); setOffers(found); setTrips(combinations);
  }
  useEffect(() => { refresh().catch(e => { if (e.message !== 'Please sign in') setError(e.message); }).finally(() => setLoading(false)); }, []);
  async function action(task: () => Promise<unknown>, success?: string) {
    setError(''); setNotice(''); setBusy(true);
    try { await task(); await refresh(); if (success) setNotice(success); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const visible = offers.filter(o => o.currency === currency && (type === 'all' || o.type === type)
    && isSpecificOffer(o) && (searchId === 'all' || o.searchId === searchId))
    .sort((a, b) => sort === 'asc' ? a.totalMinor - b.totalMinor : b.totalMinor - a.totalMinor);
  const visibleTrips = trips.filter(t => t.currency === currency && (searchId === 'all' || t.searchId === searchId)
    && (type === 'all' || type === 'flight-stay'));
  const individualOffers = visible.filter(offer => offer.type !== 'flight');
  const selectedSearches = searches.filter(search => search.active && (searchId === 'all' || search.id === searchId));
  const showStayResults = selectedSearches.some(search => search.tripTypes.includes('stay'));
  const showNonFlightResults = type !== 'flight' && selectedSearches.some(search => search.tripTypes.some(tripType => tripType !== 'flight'));
  async function searchNow(search: Search) {
    setBusy(true); setRunning(search.id); setError(''); setNotice('');
    try {
      const result = await api<{ status: string }>(`/searches/${search.id}/run`, 'POST');
      await refresh(); setSearchId(search.id); setCurrency(search.currency); setType('all');
      setNotice(result.status);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); setRunning(null); }
  }

  return <>
    {selectedOffer && <OfferDetails key={`${selectedOffer.provider}:${selectedOffer.externalId}`} offer={selectedOffer} onDismiss={() => setSelectedOffer(null)} />}
    <header className="topbar"><a className="brand" href="/"><span className="brand-mark">↗</span>good holiday<span className="brand-light">deals</span></a>
      {me ? <div className="account"><span>{me.email}</span><button className="text-button" disabled={busy} onClick={async () => {
        setBusy(true); try { await api('/logout', 'POST'); setMe(null); setSearches([]); setOffers([]); setTrips([]); }
        catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      }}>Sign out</button></div> : <span className="private-label">A little travel club</span>}
    </header>
    <main>
      {(error || notice) && <MessageModal message={error || notice} error={!!error} onDismiss={() => { setError(''); setNotice(''); }} />}
      {loading ? <p className="loading">Opening your travel notebook…</p> : !me ? <Auth onSuccess={refresh} /> : <>
        <section className="hero"><div><p className="eyebrow">LESS SEARCHING. MORE GOING.</p><h1>Your next good<br />holiday starts here<span>.</span></h1>
          <p className="intro">A wish list for your family. Fresh possibilities each morning.<br className="desktop-break" /> The final choice is always yours.</p></div>
          <div className="digest-card"><span className="sun">☀</span><p className="eyebrow">YOUR MORNING EDITION</p><strong>08:00</strong><p>{me.timezone}</p>
            <label className="toggle"><input type="checkbox" checked={me.digestEnabled} disabled={busy}
              onChange={e => { const enabled = e.target.checked; void action(() => api('/me', 'PATCH', { digestEnabled: enabled })); }} />Daily email {me.digestEnabled ? 'on' : 'paused'}</label>
            {!me.emailConfigured && <small>Email setup pending</small>}
          </div>
        </section>
        <div className="source-note"><span>◌</span><div><strong>{me.providers.length} live travel API provider{me.providers.length === 1 ? '' : 's'} connected.</strong>
          <p>{me.liveFlightPricing ? 'Live dated round trips are connected.' : 'Connect Ignav, Duffel, or Sabre for flights.'} {me.liveStayPricing ? 'Live accommodation quotes are connected.' : 'Connect Duffel Stays or Sabre lodging for accommodation.'}</p>
          <details className="source-details"><summary>View your travel sources</summary><div className="source-grid">{me.sources.map(source =>
            <div key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.name} ↗</a>
              <span className="source-mode">{source.mode === 'live-flights-stays' ? 'Live flight + stay quotes connected' : source.mode === 'live-flights' ? 'Live flight quotes connected' : 'API credentials required'}</span><small>{source.detail}</small></div>)}</div></details>
        </div></div>
        <section className="section"><div className="section-heading"><div><p className="eyebrow">01 / THE WISH LIST</p><h2>Where could you go?</h2></div>
          <button className="primary" disabled={busy} onClick={() => { setShowForm(!showForm); setEditing(null); }}>{showForm ? 'Close form' : '+ New search'}</button></div>
          {showForm && <SearchForm key={editing?.id ?? 'new'} initial={editing ?? undefined} busy={busy}
            onCancel={() => { setShowForm(false); setEditing(null); }} onSave={async data => {
            setError(''); setNotice(''); setBusy(true);
            try {
              await api(editing ? `/searches/${editing.id}` : '/searches', editing ? 'PATCH' : 'POST', data);
              await refresh(); setShowForm(false); setEditing(null);
              setNotice('Search saved. Choose Search now to find matching offers.');
            }
            catch (e) { setError((e as Error).message); } finally { setBusy(false); }
          }} />}
          {!searches.length && !showForm ? <div className="empty"><span className="empty-icon">↗</span><h3>Make room for a getaway.</h3>
            <p>Choose a departure city, a flexible window, and what a good holiday means to you.</p>
            <button className="text-button" onClick={() => setShowForm(true)}>Create your first search →</button></div> :
            <div className="search-grid">{searches.map(s => <article className={`search-card ${!s.active ? 'paused' : ''}`} key={s.id}>
              <div className="card-top"><span className="tag">{s.active ? 'Watching' : 'Paused'}</span><span>{s.currency}</span></div>
              <h3>{s.name}</h3><p className="from">From {s.departure}{s.nearbyAirports ? ' + nearby airports' : ''}</p>
              <dl><div><dt>Travel window</dt><dd>{s.earliestDeparture} → {s.latestReturn}</dd></div>
                <div><dt>Destination</dt><dd>{s.targetCountry
                  ? `${s.targetAirports.length ? s.targetAirports.join(', ') : selectedTargetCities(s).join(', ') || 'Five major airports'} · ${countryName(s.targetCountry)}` : 'Choose a destination country'}</dd></div>
                <div><dt>Your stay</dt><dd>{s.minNights === s.maxNights ? s.minNights : `${s.minNights}–${s.maxNights}`} nights</dd></div>
                <div><dt>Your people</dt><dd>{s.adults} adults{s.childrenAges.length > 0 ? ` · children aged ${s.childrenAges.join(', ')}` : ''}
                  {s.lapInfants ? ` · ${s.lapInfants} infant${s.lapInfants === 1 ? '' : 's'} on lap` : ''} · {s.rooms ?? 1} room(s)</dd></div></dl>
              <p className="preference">{s.preferences || (s.swimming !== 'any' ? `Swimming preference: ${s.swimming.replace('-', ' ')}` : 'Open to possibilities.')}</p>
              <small>{s.lastCheckedAt ? `Checked ${new Date(s.lastCheckedAt).toLocaleString()}. ${s.lastStatus ?? ''}` : 'Ready for your first search.'}</small>
              <button className="text-button edit-search" disabled={busy} onClick={() => {
                setEditing(s); setShowForm(true); setError(''); setNotice('');
              }}>Edit search</button>
              <button className="primary search-now" disabled={busy || !s.active || editing?.id === s.id}
                onClick={() => void searchNow(s)}>{running === s.id ? 'Searching sources…' : 'Search now ↗'}</button>
              <div className="card-actions"><button className="text-button" disabled={busy} onClick={() => void action(() => api(`/searches/${s.id}`, 'PATCH', { active: !s.active }))}>{s.active ? 'Pause search' : 'Resume search'}</button>
                <button className="text-button muted" disabled={busy} onClick={() => { if (window.confirm(`Delete “${s.name}”?`)) void action(() => api(`/searches/${s.id}`, 'DELETE'), 'Search deleted.'); }}>Delete</button></div>
            </article>)}</div>}
        </section>
        <section className="section"><div className="section-heading"><div><p className="eyebrow">02 / THE POSSIBILITIES</p><h2>Specific offers<span className="count">{visible.length + visibleTrips.length}</span></h2></div></div>
          <div className="filters"><label>Search<select value={searchId} onChange={e => setSearchId(e.target.value)}><option value="all">All searches</option>{searches.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label>Type<select value={type} onChange={e => setType(e.target.value)}><option value="all">All types</option><option value="flight-stay">Flight + accommodation</option><option value="package">Packages</option><option value="flight">Flights</option><option value="stay">Stays</option></select></label>
            <label>Currency<select value={currency} onChange={e => setCurrency(e.target.value)}>{['EUR', 'RON', 'USD', 'GBP'].map(c => <option key={c}>{c}</option>)}</select></label>
            <label>Sort by<select value={sort} onChange={e => setSort(e.target.value)}><option value="asc">Price: low to high</option><option value="desc">Price: high to low</option></select></label>
            <button className="text-button" disabled={busy} onClick={() => void action(refresh)}>Refresh</button>
          </div>
          <p className="filter-note">Prices are compared within one currency. Packages, flights, and stays include different things.</p>
          {running && <p className="search-progress" role="status">Checking connected travel APIs. Flexible-date flight and stay searches can take a few minutes.</p>}
          {(type === 'all' || type === 'flight') && <FlightResults offers={visible} connected={me.liveFlightPricing} onSelect={setSelectedOffer} />}
          {showStayResults && (type === 'all' || type === 'flight-stay') && <TripResults trips={visibleTrips} sort={sort} onSelect={setSelectedOffer} />}
          {type !== 'flight' && type !== 'flight-stay' && showNonFlightResults && <>
          <h3 className="results-heading">Quoted holidays and stays <span className="count">{individualOffers.length}</span></h3>
          {!individualOffers.length ? <div className="empty compact"><h3>No quoted holidays or stays yet.</h3><p>A matching quote needs specific dates, a link to the offer and a total for your party.</p></div> :
            <div className="offer-grid">{individualOffers.map(o => <article className="offer-card" key={`${o.searchId}:${o.provider}:${o.externalId}`}>
              <div className="card-top"><span className="tag">{o.type}</span><span>{o.provider}</span></div><p className="eyebrow">{o.destination}</p><h3>{o.title}</h3>
              <p>{o.departureDate} → {o.returnDate}</p><strong className="price">{money(o)}</strong><p>{o.priceBasis === 'family-total' ? 'Total for your family' : 'Indicative price · family total unverified'}</p>
              <p className="preference">{o.inclusions.join(' · ') || 'Confirm inclusions with provider'}</p><p>Swimming: {o.swimmingEvidence || 'Not verified'}</p>
              <small>Checked {new Date(o.checkedAt).toLocaleString()} · {o.searchName}</small>
              <a className="primary provider-link" href={o.url} target="_blank" rel="noopener noreferrer">Open this offer ↗</a>
              <button type="button" className="text-button" onClick={() => setSelectedOffer(o)}>View offer details</button>
            </article>)}</div>}</>}
        </section>
      </>}
      <footer><span>good holiday deals</span><p>For the places you haven’t been yet.</p><span>Plan together. Book directly.</span></footer>
    </main>
  </>;
}

function Auth({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <section className="auth-layout"><div><p className="eyebrow">GOOD HOLIDAYS START WITH A POSSIBILITY</p><h1>Somewhere<br />you’d rather be<span>.</span></h1>
    <p className="intro">Family holidays, flexible dates, and a little less searching.<br />Your daily travel shortlist, in one place.</p><div className="auth-decoration">BAGS PACKED. POSSIBILITIES OPEN. ↗</div></div>
    <form className="auth-card" onSubmit={async e => {
      e.preventDefault(); const form = new FormData(e.currentTarget); setBusy(true); setError('');
      try { await api(`/auth/${register ? 'register' : 'login'}`, 'POST', Object.fromEntries(form)); await onSuccess(); }
      catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }}><p className="eyebrow">YOUR PRIVATE TRAVEL NOTEBOOK</p><h2>{register ? 'You’re invited.' : 'Welcome back.'}</h2>
      <p>{register ? 'Use the email and code from your invitation.' : 'Sign in to see what’s out there.'}</p>
      {error && <MessageModal message={error} error onDismiss={() => setError('')} />}
      <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
      <label>Password<input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={12} maxLength={128} /></label>
      {register && <><small>Use at least 12 characters.</small><label>Invitation code<input name="invitation" autoComplete="off" required minLength={64} maxLength={64} /></label></>}
      <button className="primary" disabled={busy}>{busy ? 'One moment…' : register ? 'Create account →' : 'Sign in →'}</button>
      <button type="button" className="text-button" onClick={() => { setRegister(!register); setError(''); }}>{register ? 'Already a member? Sign in' : 'Have an invitation? Join the group'}</button>
    </form>
  </section>;
}

type DestinationAirport = { code: string; name: string; city: string; country: string };
function DestinationFields({ airports = [], country = '' }: { airports?: string[]; country?: string }) {
  const initialCountry = countryCode(country) ?? '';
  const [selectedCountry, setSelectedCountry] = useState(initialCountry);
  const [selectedAirports, setSelectedAirports] = useState<string[]>(airports);
  const [options, setOptions] = useState<DestinationAirport[]>([]);
  const [loadingAirports, setLoadingAirports] = useState(false);
  const [airportError, setAirportError] = useState('');
  useEffect(() => {
    if (!selectedCountry) { setOptions([]); setSelectedAirports([]); return; }
    let current = true;
    setLoadingAirports(true); setAirportError('');
    void api<{ airports: DestinationAirport[] }>(`/destinations/airports?country=${encodeURIComponent(selectedCountry)}`)
      .then(result => {
        if (!current) return;
        setOptions(result.airports);
        setSelectedAirports(previous => {
          const available = previous.filter(code => result.airports.some(airport => airport.code === code));
          return available.length ? available : result.airports.slice(0, 5).map(airport => airport.code);
        });
      })
      .catch(error => {
        if (!current) return;
        setAirportError((error as Error).message);
      })
      .finally(() => { if (current) setLoadingAirports(false); });
    return () => { current = false; };
  }, [selectedCountry]);
  return <div className="destination-picker">
    <label>Target country<select name="targetCountry" value={selectedCountry} required onChange={event => {
      const next = event.target.value; setSelectedCountry(next); setSelectedAirports([]); setOptions([]);
    }}>
      <option value="" disabled>Choose a country</option>{destinationCountries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
    </select></label>
    {!!selectedCountry && <fieldset><legend>Destination airports · {selectedAirports.length} of 5 selected</legend>
      <div className="checkbox-row">{options.map(airport => <label key={airport.code}><input type="checkbox" name="targetAirports" value={airport.code}
        checked={selectedAirports.includes(airport.code)} disabled={!selectedAirports.includes(airport.code) && selectedAirports.length >= 5}
        onChange={event => setSelectedAirports(current => event.target.checked ? [...current, airport.code] : current.filter(value => value !== airport.code))} />
        {airport.city} · {airport.name} ({airport.code})</label>)}</div>
      {loadingAirports && <small>Matching major cities to airports…</small>}
      {airportError && <small className="destination-error">Could not load destination airports. {airportError}</small>}
    </fieldset>}
    <p className="filter-note destination-help">A country is required. Five major airports are selected initially; deselect one to choose another, with a maximum of five.</p>
  </div>;
}

function SearchForm({ onSave, onCancel, busy, initial }: {
  onSave: (data: SearchCriteria) => Promise<void>; onCancel: () => void; busy: boolean; initial?: SearchCriteria;
}) {
  const [localError, setLocalError] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, []);
  const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  return <form ref={formRef} className="search-form" onSubmit={async e => {
    e.preventDefault(); setLocalError(''); const f = new FormData(e.currentTarget);
    const ages = String(f.get('childrenAges') ?? '').trim();
    if (ages && !/^\d{1,2}(\s*,\s*\d{1,2})*$/.test(ages)) { setLocalError('Enter children’s ages as numbers separated by commas.'); return; }
    const result = searchSchema.safeParse({ name: String(f.get('name')), departure: String(f.get('departure')),
      targetCities: [], targetAirports: f.getAll('targetAirports').map(value => String(value)), targetCountry: String(f.get('targetCountry') ?? ''),
      nearbyAirports: f.has('nearbyAirports'), earliestDeparture: String(f.get('earliestDeparture')), latestReturn: String(f.get('latestReturn')),
      minNights: Number(f.get('minNights')), maxNights: Number(f.get('maxNights')), adults: Number(f.get('adults')),
      rooms: Number(f.get('rooms')),
      childrenAges: ages ? ages.split(',').map(v => Number(v.trim())) : [], lapInfants: Number(f.get('lapInfants')),
      currency: f.get('currency') as SearchCriteria['currency'],
      tripTypes: f.getAll('tripTypes') as SearchCriteria['tripTypes'], swimming: f.get('swimming') as SearchCriteria['swimming'],
      preferences: String(f.get('preferences')), active: f.has('active') });
    if (!result.success) { setLocalError(result.error.issues.map(issue => issue.message).join('; ')); return; }
    await onSave(result.data);
  }}><div className="form-heading"><h3>{initial ? 'Edit your search' : 'A new possibility'}</h3>
    <p>{initial ? 'Update any details, then save your changes before searching.' : 'Keep the dates flexible. Tell us what matters.'}</p></div>
    {localError && <MessageModal message={localError} error onDismiss={() => setLocalError('')} />}
    <fieldset className="search-form-fields" disabled={busy}>
    <div className="form-grid"><label>Give this search a name<input name="name" defaultValue={initial?.name} placeholder="A sunny February escape" required maxLength={100} /></label>
      <label>Departure city or airport<input name="departure" defaultValue={initial?.departure} placeholder="Bucharest / OTP" required minLength={2} maxLength={120} /></label>
      <DestinationFields airports={initial?.targetAirports} country={initial?.targetCountry} />
      <label>Earliest departure<input name="earliestDeparture" type="date" defaultValue={initial?.earliestDeparture ?? future(60)} min={initial ? undefined : future(0)} required /></label>
      <label>Latest return<input name="latestReturn" type="date" defaultValue={initial?.latestReturn ?? future(90)} min={initial ? undefined : future(1)} required /></label>
      <label>Minimum nights<input name="minNights" type="number" min={1} max={60} defaultValue={initial?.minNights ?? 5} required /></label>
      <label>Maximum nights<input name="maxNights" type="number" min={1} max={60} defaultValue={initial?.maxNights ?? 8} required /></label>
      <label>Adults<input name="adults" type="number" min={1} max={8} defaultValue={initial?.adults ?? 2} required /></label>
      <label>Children’s ages at departure<input name="childrenAges" defaultValue={initial?.childrenAges.join(', ')} placeholder="e.g. 4, 8 (leave empty if none)" maxLength={30} /></label>
      <label>Infants under 2 travelling on a lap<input name="lapInfants" type="number" min={0} max={6} defaultValue={initial?.lapInfants ?? 0} required />
        <small>Other infants are priced with their own seat.</small></label>
      <label>Rooms for your stay<input name="rooms" type="number" min={1} max={6} defaultValue={initial?.rooms ?? 1} required /></label>
      <label>Price currency<select name="currency" defaultValue={initial?.currency ?? 'EUR'}>{['EUR', 'RON', 'USD', 'GBP'].map(c => <option key={c}>{c}</option>)}</select></label>
      <label>Swimming preference<select name="swimming" defaultValue={initial?.swimming ?? 'any'}><option value="any">No preference</option><option value="sea">Sea swimming</option><option value="heated-pool">Heated pool</option><option value="either">Sea or heated pool</option></select></label>
    </div>
    <div className="checkbox-row"><label><input name="nearbyAirports" type="checkbox" defaultChecked={initial?.nearbyAirports ?? true} />Include nearby airports</label>
      <fieldset><legend>Look for</legend>{(['package', 'flight', 'stay'] as const).map(t => <label key={t}><input type="checkbox" name="tripTypes" value={t} defaultChecked={initial ? initial.tripTypes.includes(t) : true} />{t === 'package' ? 'Packages' : t === 'flight' ? 'Flights' : 'Stays'}</label>)}</fieldset></div>
    <label>What would make this a good holiday?<textarea name="preferences" defaultValue={initial?.preferences} maxLength={1000} rows={3} placeholder="Somewhere sunny, warm enough to swim, easy flights with the kids…" /></label>
    <div className="checkbox-row"><label><input name="active" type="checkbox" defaultChecked={initial?.active ?? true} />Keep this search active</label></div>
    </fieldset>
    <div className="form-bottom"><small>Weather and swimming conditions are preferences, never guarantees.</small>
      <div className="form-actions"><button type="button" className="text-button" disabled={busy} onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={busy}>{busy ? 'Saving…' : initial ? 'Save changes →' : 'Save search →'}</button></div></div>
  </form>;
}

createRoot(document.getElementById('root')!).render(<App />);
