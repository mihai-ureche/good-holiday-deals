import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { money, type Offer, type Discovery, type SavedSearch, type SearchCriteria } from '../../../packages/shared/src/index.js';
import './style.css';
import './sources.css';
import './trips.css';
import { TripResults, type ListedTrip } from './TripResults.js';

type Me = { email: string; digestEnabled: boolean; timezone: string; emailConfigured: boolean; providers: string[];
  sources: { id: string; name: string; url: string; mode: string; detail: string }[] };
type Search = SavedSearch & { lastCheckedAt: string | null; lastStatus: string | null };
type ListedOffer = Offer & { searchId: string; searchName: string };
type ListedDiscovery = Discovery & { searchId: string; searchName: string };
async function api<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method, credentials: 'same-origin',
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
    ...(method !== 'GET' ? { body: JSON.stringify(data ?? {}) } : {}) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Could not complete your request');
  return body;
}
function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [searches, setSearches] = useState<Search[]>([]);
  const [offers, setOffers] = useState<ListedOffer[]>([]);
  const [discoveries, setDiscoveries] = useState<ListedDiscovery[]>([]);
  const [trips, setTrips] = useState<ListedTrip[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [currency, setCurrency] = useState('EUR');
  const [sort, setSort] = useState('asc');
  const [type, setType] = useState('all');
  const [searchId, setSearchId] = useState('all');
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [priceUnit, setPriceUnit] = useState('all');
  const [leadLimit, setLeadLimit] = useState(24);

  async function refresh() {
    const [account, saved, found, leads, combinations] = await Promise.all([api<Me>('/me'), api<Search[]>('/searches'), api<ListedOffer[]>('/offers'), api<ListedDiscovery[]>('/discoveries'), api<ListedTrip[]>('/trips')]);
    setMe(account); setSearches(saved); setOffers(found); setDiscoveries(leads); setTrips(combinations);
  }
  useEffect(() => { refresh().catch(e => { if (e.message !== 'Please sign in') setError(e.message); }).finally(() => setLoading(false)); }, []);
  async function action(task: () => Promise<unknown>, success?: string) {
    setError(''); setNotice(''); setBusy(true);
    try { await task(); await refresh(); if (success) setNotice(success); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const visible = offers.filter(o => o.currency === currency && (type === 'all' || o.type === type)
    && o.priceBasis === 'family-total' && (searchId === 'all' || o.searchId === searchId))
    .sort((a, b) => sort === 'asc' ? a.totalMinor - b.totalMinor : b.totalMinor - a.totalMinor);
  const publicOffers = discoveries.filter(o => o.currency === currency && (type === 'all' || o.type === type)
    && (searchId === 'all' || o.searchId === searchId) && (priceUnit === 'all' || o.priceUnit === priceUnit))
    .sort((a, b) => a.priceUnit.localeCompare(b.priceUnit) || (sort === 'asc' ? a.fromMinor - b.fromMinor : b.fromMinor - a.fromMinor));
  const visibleTrips = trips.filter(t => t.currency === currency && (searchId === 'all' || t.searchId === searchId)
    && (type === 'all' || type === 'flight-stay'));
  async function searchNow(search: Search) {
    setBusy(true); setRunning(search.id); setError(''); setNotice('');
    try {
      const result = await api<{ status: string }>(`/searches/${search.id}/run`, 'POST');
      await refresh(); setSearchId(search.id); setCurrency(search.currency); setType('all'); setLeadLimit(24);
      setNotice(result.status);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); setRunning(null); }
  }

  return <>
    <header className="topbar"><a className="brand" href="/"><span className="brand-mark">↗</span>good holiday<span className="brand-light">deals</span></a>
      {me ? <div className="account"><span>{me.email}</span><button className="text-button" disabled={busy} onClick={async () => {
        setBusy(true); try { await api('/logout', 'POST'); setMe(null); setSearches([]); setOffers([]); setDiscoveries([]); setTrips([]); }
        catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      }}>Sign out</button></div> : <span className="private-label">A little travel club</span>}
    </header>
    <main>
      {error && <div className="alert error" role="alert">{error}</div>}
      {notice && <div className="alert" role="status">{notice}</div>}
      {loading ? <p className="loading">Opening your travel notebook…</p> : !me ? <Auth onSuccess={refresh} /> : <>
        <section className="hero"><div><p className="eyebrow">LESS SEARCHING. MORE GOING.</p><h1>Your next good<br />holiday starts here<span>.</span></h1>
          <p className="intro">A wish list for your family. Fresh possibilities each morning.<br className="desktop-break" /> The final choice is always yours.</p></div>
          <div className="digest-card"><span className="sun">☀</span><p className="eyebrow">YOUR MORNING EDITION</p><strong>08:00</strong><p>{me.timezone}</p>
            <label className="toggle"><input type="checkbox" checked={me.digestEnabled} disabled={busy}
              onChange={e => { const enabled = e.target.checked; void action(() => api('/me', 'PATCH', { digestEnabled: enabled })); }} />Daily email {me.digestEnabled ? 'on' : 'paused'}</label>
            {!me.emailConfigured && <small>Email setup pending</small>}
          </div>
        </section>
        <div className="source-note"><span>◌</span><div><strong>{me.providers.length} public offer sources ready to explore.</strong>
          <p>Create a search, then choose Search now. Advertised prices need confirmation for your dates and family.</p>
          <details className="source-details"><summary>View your travel sources</summary><div className="source-grid">{me.sources.map(source =>
            <div key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.name} ↗</a>
              <span className="source-mode">{source.mode === 'public-offers' ? 'Advertised offers connected' : source.mode === 'reviews' ? 'Reviews — open directly' : 'Open directly — integration pending'}</span><small>{source.detail}</small></div>)}</div></details>
        </div></div>
        <section className="section"><div className="section-heading"><div><p className="eyebrow">01 / THE WISH LIST</p><h2>Where could you go?</h2></div>
          <button className="primary" onClick={() => setShowForm(!showForm)}>{showForm ? 'Close form' : '+ New search'}</button></div>
          {showForm && <SearchForm busy={busy} onSave={async data => {
            setError(''); setBusy(true);
            try { await api('/searches', 'POST', data); await refresh(); setShowForm(false); setNotice('Search saved. Choose Search now to explore offers immediately.'); }
            catch (e) { setError((e as Error).message); } finally { setBusy(false); }
          }} />}
          {!searches.length && !showForm ? <div className="empty"><span className="empty-icon">↗</span><h3>Make room for a getaway.</h3>
            <p>Choose a departure city, a flexible window, and what a good holiday means to you.</p>
            <button className="text-button" onClick={() => setShowForm(true)}>Create your first search →</button></div> :
            <div className="search-grid">{searches.map(s => <article className={`search-card ${!s.active ? 'paused' : ''}`} key={s.id}>
              <div className="card-top"><span className="tag">{s.active ? 'Watching' : 'Paused'}</span><span>{s.currency}</span></div>
              <h3>{s.name}</h3><p className="from">From {s.departure}{s.nearbyAirports ? ' + nearby airports' : ''}</p>
              <dl><div><dt>Travel window</dt><dd>{s.earliestDeparture} → {s.latestReturn}</dd></div>
                <div><dt>Your stay</dt><dd>{s.minNights === s.maxNights ? s.minNights : `${s.minNights}–${s.maxNights}`} nights</dd></div>
                <div><dt>Your people</dt><dd>{s.adults} adults{s.childrenAges.length > 0 ? ` · children aged ${s.childrenAges.join(', ')}` : ''} · {s.rooms ?? 1} room(s)</dd></div></dl>
              <p className="preference">{s.preferences || (s.swimming !== 'any' ? `Swimming preference: ${s.swimming.replace('-', ' ')}` : 'Open to possibilities.')}</p>
              <small>{s.lastCheckedAt ? `Checked ${new Date(s.lastCheckedAt).toLocaleString()}. ${s.lastStatus ?? ''}` : 'Ready for your first search.'}</small>
              <button className="primary search-now" disabled={busy || !s.active} onClick={() => void searchNow(s)}>{running === s.id ? 'Searching sources…' : 'Search now ↗'}</button>
              <div className="card-actions"><button className="text-button" disabled={busy} onClick={() => void action(() => api(`/searches/${s.id}`, 'PATCH', { active: !s.active }))}>{s.active ? 'Pause search' : 'Resume search'}</button>
                <button className="text-button muted" disabled={busy} onClick={() => { if (window.confirm(`Delete “${s.name}”?`)) void action(() => api(`/searches/${s.id}`, 'DELETE'), 'Search deleted.'); }}>Delete</button></div>
            </article>)}</div>}
        </section>
        <section className="section"><div className="section-heading"><div><p className="eyebrow">02 / THE POSSIBILITIES</p><h2>Deals worth a look<span className="count">{visible.length + publicOffers.length + visibleTrips.length}</span></h2></div></div>
          <div className="filters"><label>Search<select value={searchId} onChange={e => setSearchId(e.target.value)}><option value="all">All searches</option>{searches.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label>Type<select value={type} onChange={e => setType(e.target.value)}><option value="all">All types</option><option value="flight-stay">Flight + accommodation</option><option value="package">Packages</option><option value="flight">Flights</option><option value="stay">Stays</option></select></label>
            <label>Currency<select value={currency} onChange={e => setCurrency(e.target.value)}>{['EUR', 'RON', 'USD', 'GBP'].map(c => <option key={c}>{c}</option>)}</select></label>
            <label>Sort by<select value={sort} onChange={e => setSort(e.target.value)}><option value="asc">Price: low to high</option><option value="desc">Price: high to low</option></select></label>
            <button className="text-button" disabled={busy} onClick={() => void action(refresh)}>Refresh</button>
          </div>
          <p className="filter-note">Prices are compared within one currency. Packages, flights, and stays include different things.</p>
          {running && <p className="search-progress" role="status">Checking public sources. The first search can take up to five minutes; cached results are faster.</p>}
          {(type === 'all' || type === 'flight-stay') && <TripResults trips={visibleTrips} sort={sort} />}
          <h3 className="results-heading">Confirmed family totals <span className="count">{visible.length}</span></h3>
          {!visible.length ? <div className="empty compact"><h3>No confirmed family quotes yet.</h3><p>Public promotions appear below. Their advertised starting prices do not confirm availability or the total for your family.</p></div> :
            <div className="offer-grid">{visible.map(o => <article className="offer-card" key={`${o.searchId}:${o.provider}:${o.externalId}`}>
              <div className="card-top"><span className="tag">{o.type}</span><span>{o.provider}</span></div><p className="eyebrow">{o.destination}</p><h3>{o.title}</h3>
              <p>{o.departureDate} → {o.returnDate}</p><strong className="price">{money(o)}</strong><p>{o.priceBasis === 'family-total' ? 'Total for your family' : 'Indicative price · family total unverified'}</p>
              <p className="preference">{o.inclusions.join(' · ') || 'Confirm inclusions with provider'}</p><p>Swimming: {o.swimmingEvidence || 'Not verified'}</p>
              <small>Checked {new Date(o.checkedAt).toLocaleString()} · {o.searchName}</small><a className="primary provider-link" href={o.url} target="_blank" rel="noopener noreferrer">View at provider ↗</a>
            </article>)}</div>}
          <div className="advertised-heading"><div><h3 className="results-heading">Advertised offers to explore <span className="count">{publicOffers.length}</span></h3>
            <p className="filter-note">Starting prices from provider pages. Unknown dates, airports, swimming conditions and family suitability require checking. Prices are grouped by their stated basis before sorting.</p></div>
            <label>Price basis<select value={priceUnit} onChange={e => { setPriceUnit(e.target.value); setLeadLimit(24); }}><option value="all">All price bases</option><option value="person">Per person</option><option value="advertised-stay">Advertised stay</option><option value="room-night">Room/night (check basis)</option><option value="unspecified">Unspecified basis</option></select></label></div>
          {!publicOffers.length ? <div className="empty compact"><h3>No advertised offers for these filters yet.</h3><p>Choose Search now on an active search. Check the source status on your search card if a provider is unavailable.</p></div> :
            <div className="offer-grid">{publicOffers.slice(0, leadLimit).map(o => <article className="offer-card advertised-card" key={`${o.searchId}:${o.provider}:${o.externalId}`}>
              <div className="card-top"><span className="tag">{o.type} · advertised</span><span>{me.sources.find(s => s.id === o.provider)?.name ?? o.provider}</span></div>
              <p className="eyebrow">{o.destination}</p><h3>{o.title}</h3><strong className="price"><span className="from-label">From </span>{money({ totalMinor: o.fromMinor, currency: o.currency })}</strong>
              <p className="price-basis">{o.priceUnit === 'person' ? 'Per person · family total unconfirmed' : o.priceUnit === 'room-night' ? 'Room/night assumed · check basis and capacity' : o.priceUnit === 'advertised-stay' ? 'Advertised stay · family total unconfirmed' : 'Price basis unspecified · family total unconfirmed'}</p>
              <p>{o.departureDates.length ? `Advertised departure: ${o.departureDates.join(', ')}` : o.dateWindow ? `Advertised departure window: ${o.dateWindow.earliestDeparture} – ${o.dateWindow.latestDeparture}` : 'Travel dates not confirmed'}{o.nights ? ` · ${o.nights} nights` : ''}</p>
              <p className="preference">{o.conditions}</p><small>Checked {new Date(o.checkedAt).toLocaleString()} · {o.searchName}</small>
              <a className="primary provider-link" href={o.url} target="_blank" rel="noopener noreferrer">Check dates & family price ↗</a>
            </article>)}</div>}
          {publicOffers.length > leadLimit && <button className="text-button" onClick={() => setLeadLimit(leadLimit + 24)}>Show more advertised offers</button>}
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
      {error && <p className="error-text" role="alert">{error}</p>}
      <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
      <label>Password<input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={12} maxLength={128} /></label>
      {register && <><small>Use at least 12 characters.</small><label>Invitation code<input name="invitation" autoComplete="off" required minLength={64} maxLength={64} /></label></>}
      <button className="primary" disabled={busy}>{busy ? 'One moment…' : register ? 'Create account →' : 'Sign in →'}</button>
      <button type="button" className="text-button" onClick={() => { setRegister(!register); setError(''); }}>{register ? 'Already a member? Sign in' : 'Have an invitation? Join the group'}</button>
    </form>
  </section>;
}

function SearchForm({ onSave, busy }: { onSave: (data: SearchCriteria) => Promise<void>; busy: boolean }) {
  const [localError, setLocalError] = useState('');
  const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  return <form className="search-form" onSubmit={async e => {
    e.preventDefault(); setLocalError(''); const f = new FormData(e.currentTarget);
    const ages = String(f.get('childrenAges') ?? '').trim();
    if (ages && !/^\d{1,2}(\s*,\s*\d{1,2})*$/.test(ages)) { setLocalError('Enter children’s ages as numbers separated by commas.'); return; }
    await onSave({ name: String(f.get('name')), departure: String(f.get('departure')),
      nearbyAirports: f.has('nearbyAirports'), earliestDeparture: String(f.get('earliestDeparture')), latestReturn: String(f.get('latestReturn')),
      minNights: Number(f.get('minNights')), maxNights: Number(f.get('maxNights')), adults: Number(f.get('adults')),
      rooms: Number(f.get('rooms')),
      childrenAges: ages ? ages.split(',').map(v => Number(v.trim())) : [], currency: f.get('currency') as SearchCriteria['currency'],
      tripTypes: f.getAll('tripTypes') as SearchCriteria['tripTypes'], swimming: f.get('swimming') as SearchCriteria['swimming'],
      preferences: String(f.get('preferences')), active: true });
  }}><div className="form-heading"><h3>A new possibility</h3><p>Keep the dates flexible. Tell us what matters.</p></div>
    {localError && <p role="alert" className="error-text">{localError}</p>}
    <div className="form-grid"><label>Give this search a name<input name="name" placeholder="A sunny February escape" required maxLength={100} /></label>
      <label>Departure city or airport<input name="departure" placeholder="Bucharest / OTP" required minLength={2} maxLength={120} /></label>
      <label>Earliest departure<input name="earliestDeparture" type="date" defaultValue={future(60)} min={future(0)} required /></label>
      <label>Latest return<input name="latestReturn" type="date" defaultValue={future(90)} min={future(1)} required /></label>
      <label>Minimum nights<input name="minNights" type="number" min={1} max={60} defaultValue={5} required /></label>
      <label>Maximum nights<input name="maxNights" type="number" min={1} max={60} defaultValue={8} required /></label>
      <label>Adults<input name="adults" type="number" min={1} max={8} defaultValue={2} required /></label>
      <label>Children’s ages at departure<input name="childrenAges" placeholder="e.g. 4, 8 (leave empty if none)" maxLength={30} /></label>
      <label>Rooms for the stay budget<input name="rooms" type="number" min={1} max={6} defaultValue={1} required /></label>
      <label>Price currency<select name="currency">{['EUR', 'RON', 'USD', 'GBP'].map(c => <option key={c}>{c}</option>)}</select></label>
      <label>Swimming preference<select name="swimming"><option value="any">No preference</option><option value="sea">Sea swimming</option><option value="heated-pool">Heated pool</option><option value="either">Sea or heated pool</option></select></label>
    </div>
    <div className="checkbox-row"><label><input name="nearbyAirports" type="checkbox" defaultChecked />Include nearby airports</label>
      <fieldset><legend>Look for</legend>{(['package', 'flight', 'stay'] as const).map(t => <label key={t}><input type="checkbox" name="tripTypes" value={t} defaultChecked />{t === 'package' ? 'Packages' : t === 'flight' ? 'Flights' : 'Stays'}</label>)}</fieldset></div>
    <label>What would make this a good holiday?<textarea name="preferences" maxLength={1000} rows={3} placeholder="Somewhere sunny, warm enough to swim, easy flights with the kids…" /></label>
    <div className="form-bottom"><small>Weather and swimming conditions are preferences, never guarantees.</small><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save search →'}</button></div>
  </form>;
}

createRoot(document.getElementById('root')!).render(<App />);
