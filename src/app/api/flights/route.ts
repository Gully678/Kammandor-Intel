
import { NextResponse } from 'next/server';
import { stealthFetch } from '@/lib/stealthFetch';

// Vercel serverless config — extend timeout so all 3 data sources can respond
export const maxDuration = 60;

/**
 * OSIRIS — Flight Data API
 * Fetches real-time aircraft positions from adsb.lol (no API key required)
 * Covers 6 global regions for maximum coverage
 */

const REGIONS = [
  { lat: 39.8, lon: -98.5, dist: 2000 },   // North America
  { lat: 50.0, lon: 15.0, dist: 2000 },     // Europe
  { lat: 35.0, lon: 105.0, dist: 2000 },    // Asia
  { lat: -25.0, lon: 133.0, dist: 2000 },   // Australia
  { lat: 0.0, lon: 20.0, dist: 2500 },      // Africa
  { lat: -15.0, lon: -60.0, dist: 2000 },   // South America
];

// Helicopter type codes
const HELI_TYPES = new Set([
  'R22','R44','R66','B06','B06T','B204','B205','B206','B212','B222','B230',
  'B407','B412','B427','B429','B430','B505','B525',
  'AS32','AS35','AS50','AS55','AS65',
  'EC20','EC25','EC30','EC35','EC45','EC55','EC75',
  'H125','H130','H135','H145','H155','H160','H175','H215','H225',
  'S55','S58','S61','S64','S70','S76','S92',
  'A109','A119','A139','A169','A189','AW09',
  'MD52','MD60','MDHI','MD90','NOTR',
  'B47G','HUEY','GAMA','CABR','EXE',
]);

// Private jet types
const PRIVATE_JET_TYPES = new Set([
  'G150','G200','G280','GLEX','G500','G550','G600','G650','G700',
  'GLF2','GLF3','GLF4','GLF5','GLF6','GL5T','GL7T','GV','GIV',
  'CL30','CL35','CL60','BD70','BD10',
  'C25A','C25B','C25C','C500','C510','C525','C550','C560','C56X','C680','C700','C750',
  'E35L','E50P','E55P','E545','E550',
  'FA50','FA7X','FA8X','F900','F2TH',
  'LJ35','LJ40','LJ45','LJ60','LJ70','LJ75',
  'PC12','PC24','TBM7','TBM8','TBM9',
  'PRM1','SF50','EA50','VLJ',
]);

// Military type indicators
const MILITARY_INDICATORS = new Set([
  'C17','C5M','C130','C30J','KC10','KC46','KC35','E3CF','E3TF','E8A',
  'B1B','B2','B52','F16','F15','F18','F22','F35','A10','F117',
  'RC135','E6B','P8A','P3','MQ9','RQ4','U2','EP3','RC12',
  'V22','CH47','UH60','AH64','AH1Z','MV22',
  'EUFI','RFAL','TORD','TYP','GR4',
]);

const AIRLINE_CODE_RE = /^([A-Z]{3})\d/;

async function fetchRegion(region: typeof REGIONS[0]): Promise<any[]> {
  try {
    const url = `https://api.adsb.lol/v2/point/${region.lat}/${region.lon}/${region.dist}`;
    const res = await stealthFetch(url, {
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const data = await res.json();
      return data.ac || [];
    }
  } catch (e) {
    console.warn(`Region fetch failed for lat=${region.lat}:`, e);
  }
  return [];
}

function classifyFlight(f: any) {
  const modelUpper = (f.t || '').toUpperCase();
  const flightStr = (f.flight || '').trim().toUpperCase();
  const dbFlags = (f.dbFlags || 0);

  // Skip fixed structures
  if (modelUpper === 'TWR') return null;

  const lat = f.lat;
  const lon = f.lon;
  if (lat == null || lon == null) return null;

  const callsign = flightStr || f.hex || 'UNKNOWN';
  const altRaw = f.alt_baro;
  const altMeters = typeof altRaw === 'number' ? altRaw * 0.3048 : 0;
  const speedKnots = typeof f.gs === 'number' ? Math.round(f.gs * 10) / 10 : null;
  const heading = f.track || 0;
  const isHeli = HELI_TYPES.has(modelUpper) || f.category_os === 8;
  const isGrounded = typeof altRaw === 'number' && altRaw < 100;

  // OpenSky specific categorizations
  const isOsMilitary = f.category_os === 14; // UAVs often default to military in OSINT context
  const isOsJet = f.category_os === 7 || f.category_os === 3;
  const isOsPrivate = f.category_os === 2;

  // Extract airline code
  const airlineMatch = AIRLINE_CODE_RE.exec(callsign);
  const airlineCode = airlineMatch ? airlineMatch[1] : '';

  // Classification
  let category: 'commercial' | 'private' | 'jet' | 'military' = 'commercial';
  if (isOsMilitary || dbFlags & 1 || MILITARY_INDICATORS.has(modelUpper) || (f.flight || '').match(/^(RCH|KING|DUKE|EVAC|JAKE|REACH|CONVOY)\d/i)) {
    category = 'military';
  } else if (isOsJet || PRIVATE_JET_TYPES.has(modelUpper)) {
    category = 'jet';
  } else if (isOsPrivate || (!airlineCode && modelUpper && !['A319','A320','A321','A332','A333','A339','A343','A359','A388','B737','B738','B739','B38M','B39M','B752','B753','B763','B764','B772','B77L','B77W','B788','B789','B78X','E170','E175','E190','E195','CRJ7','CRJ9','AT43','AT72','DH8D'].includes(modelUpper))) {
    category = 'private';
  }

  return {
    callsign,
    lat: Math.round(lat * 100000) / 100000,
    lng: Math.round(lon * 100000) / 100000,
    alt: Math.round(altMeters),
    heading: Math.round(heading),
    speed_knots: speedKnots,
    model: f.t || 'Unknown',
    icao24: f.hex || '',
    registration: f.r || 'N/A',
    squawk: f.squawk || '',
    airline_code: airlineCode,
    aircraft_category: isHeli ? 'heli' : 'plane',
    category,
    grounded: isGrounded,
    nac_p: f.nac_p,
    type: 'flight',
  };
}

// In-memory cache to prevent global fan-out abuse
// NOTE (Issue #110): This cache is per-isolate in serverless environments (Vercel).
// Multiple isolates may each hold their own cache, but this is acceptable because:
// 1. It coalesces concurrent requests within the same isolate
// 2. It prevents hammering adsb.lol which would cause rate-limit bans
// For a globally shared cache, migrate to Vercel KV or similar persistent store.
let cachedData: any = null;
let lastFetchTime = 0;
// 90s cache window. Full-globe OpenSky /states/all costs 4 credits/call; the authenticated
// account budget is 4000 credits/day = 1000 calls/day = one per ~86s. A shorter TTL (the old
// 45s) under steady traffic issues ~1920 calls/day = ~7680 credits — roughly 2x the authenticated
// budget and ~19x the anonymous budget, which is what got the server IP rate-limited.
const CACHE_TTL = 90000;
let fetchPromise: Promise<any> | null = null;

// When OpenSky returns 429 (rate-limited), stop hammering it for a while. Re-poking a limited
// endpoint on every cache miss keeps the IP throttled and prevents the quota from resetting.
// During cooldown we skip OpenSky entirely and serve the adsb.lol regional fallback.
let openSkyCooldownUntil = 0;
const OPENSKY_COOLDOWN = 15 * 60 * 1000; // 15 minutes

// OpenSky OAuth2 token cache.
// Anonymous OpenSky requests are rate-limited PER SOURCE IP; on Vercel the shared
// datacenter IP exhausts the anonymous pool and returns 429 — which is why the live
// server falls back to the ~10%-coverage adsb.lol regional fetch while localhost
// (residential IP) sees the full feed. Authenticated requests draw from the account's
// own credit pool (4000/day) instead, bypassing the per-IP throttle.
// Set OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET to enable; without them this is a no-op
// and the code falls back to anonymous access exactly as before.
let osToken: string | null = null;
let osTokenExpiry = 0;

async function getOpenSkyToken(): Promise<string | null> {
  const id = process.env.OPENSKY_CLIENT_ID;
  const secret = process.env.OPENSKY_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (osToken && Date.now() < osTokenExpiry) return osToken;

  try {
    const res = await fetch(
      'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: id,
          client_secret: secret,
        }),
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) {
      console.warn('[OSIRIS] OpenSky token request failed:', res.status);
      return null;
    }
    const data = await res.json();
    osToken = data.access_token;
    // Refresh 60s before the real expiry to avoid using a token mid-rotation
    osTokenExpiry = Date.now() + ((data.expires_in || 1800) - 60) * 1000;
    return osToken;
  } catch (e) {
    console.warn('[OSIRIS] OpenSky token error:', e);
    return null;
  }
}

export async function GET() {
  const now = Date.now();

  // Return cached data if within TTL
  if (cachedData && now - lastFetchTime < CACHE_TTL) {
    return NextResponse.json(cachedData, {
      headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
    });
  }

  // Coalesce concurrent requests: wait for the active fetch rather than starting a new one
  if (fetchPromise) {
    try {
      const data = await fetchPromise;
      return NextResponse.json(data, {
        headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
      });
    } catch {
      // Fallback to error if the pending fetch failed
      return NextResponse.json({ error: 'Failed to fetch flight data' }, { status: 500 });
    }
  }

  const JAMMING_NACAP_THRESHOLD = 4;

  // Start new global fetch
  fetchPromise = (async () => {
    // Skip OpenSky entirely while it's cooling down from a recent 429 — re-poking a
    // rate-limited endpoint keeps the IP throttled and stops the quota from resetting.
    const skipOpenSky = Date.now() < openSkyCooldownUntil;

    // Authenticate to OpenSky when credentials are present so the live server draws
    // from the account credit pool instead of the throttled anonymous per-IP pool.
    const token = skipOpenSky ? null : await getOpenSkyToken();
    const osInit: RequestInit = token
      ? { signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${token}` } }
      : { signal: AbortSignal.timeout(30000) };

    // Fetch OpenSky for global traffic and airplanes.live for military & private jets
    const [osRes, milRes, laddRes] = await Promise.allSettled([
      skipOpenSky
        ? Promise.reject(new Error('OpenSky in cooldown'))
        : stealthFetch('https://opensky-network.org/api/states/all', osInit),
      stealthFetch('https://api.airplanes.live/v2/mil', { signal: AbortSignal.timeout(20000) }),
      stealthFetch('https://api.airplanes.live/v2/ladd', { signal: AbortSignal.timeout(20000) })
    ]);

    const allRaw: any[] = [];
    const seenHex = new Set<string>();

    // Process military flights first so they take precedence (preserves nac_p for jamming)
    if (milRes.status === 'fulfilled' && milRes.value.ok) {
      try {
        const data = await milRes.value.json();
        for (const ac of (data.ac || [])) {
          const hex = (ac.hex || '').toLowerCase().trim();
          if (hex && !seenHex.has(hex)) {
            seenHex.add(hex);
            allRaw.push(ac);
          }
        }
      } catch(e) {}
    }

    // Process LADD (Private Jets) flights
    if (laddRes.status === 'fulfilled' && laddRes.value.ok) {
      try {
        const data = await laddRes.value.json();
        for (const ac of (data.ac || [])) {
          const hex = (ac.hex || '').toLowerCase().trim();
          if (hex && !seenHex.has(hex)) {
            seenHex.add(hex);
            allRaw.push(ac);
          }
        }
      } catch(e) {}
    }

    // Process OpenSky flights globally
    let openSkyWorked = false;
    if (osRes.status === 'fulfilled' && osRes.value.status === 429) {
      // Rate-limited — back off so we don't keep the IP throttled.
      openSkyCooldownUntil = Date.now() + OPENSKY_COOLDOWN;
      console.warn('[OSIRIS] OpenSky returned 429 — cooling down for 15 min, using adsb.lol fallback');
    }
    if (osRes.status === 'fulfilled' && osRes.value.ok) {
      try {
        const data = await osRes.value.json();
        const states = data.states || [];
        if (states.length > 100) openSkyWorked = true;
        for (const s of states) {
          const hex = (s[0] || '').toLowerCase().trim();
          if (hex && !seenHex.has(hex)) {
            seenHex.add(hex);
            // Translate OpenSky to tar1090 format
            allRaw.push({
              hex: s[0],
              flight: s[1]?.trim(),
              lon: s[5],
              lat: s[6],
              alt_baro: typeof s[7] === 'number' ? s[7] * 3.28084 : null, // meters to feet
              gs: typeof s[9] === 'number' ? s[9] * 1.94384 : null, // m/s to knots
              track: s[10],
              squawk: s[14],
              category_os: s[17], // OpenSky category
            });
          }
        }
      } catch(e) {}
    }

    // Fallback: If OpenSky failed (429 rate limit / blocked datacenter IP), fan out to adsb.lol regions
    if (!openSkyWorked) {
      console.warn('[OSIRIS] OpenSky unavailable — falling back to adsb.lol regional fetch');
      const regionResults = await Promise.allSettled(REGIONS.map(r => fetchRegion(r)));
      for (const result of regionResults) {
        if (result.status === 'fulfilled') {
          for (const ac of result.value) {
            const hex = (ac.hex || '').toLowerCase().trim();
            if (hex && !seenHex.has(hex)) {
              seenHex.add(hex);
              allRaw.push(ac);
            }
          }
        }
      }
    }

    // Classify all flights
    const commercial: any[] = [];
    const privateFl: any[] = [];
    const jets: any[] = [];
    const military: any[] = [];
    const gpsJamming: any[] = [];

    for (const raw of allRaw) {
      const flight = classifyFlight(raw);
      if (!flight) continue;

      // GPS jamming detection
      if (typeof flight.nac_p === 'number' && flight.nac_p <= JAMMING_NACAP_THRESHOLD && !flight.grounded) {
        gpsJamming.push({
          lat: flight.lat,
          lng: flight.lng,
          nac_p: flight.nac_p,
          callsign: flight.callsign,
        });
      }

      switch (flight.category) {
        case 'military': military.push(flight); break;
        case 'jet': jets.push(flight); break;
        case 'private': privateFl.push(flight); break;
        default: commercial.push(flight);
      }
    }

    // Aggregate GPS jamming zones (grid-based)
    const jammingZones = aggregateJamming(gpsJamming, JAMMING_NACAP_THRESHOLD);

    return {
      commercial_flights: commercial,
      private_flights: privateFl,
      private_jets: jets,
      military_flights: military,
      gps_jamming: jammingZones,
      total: allRaw.length,
      timestamp: new Date().toISOString(),
    };
  })();

  try {
    const data = await fetchPromise;
    cachedData = data;
    lastFetchTime = Date.now();
    fetchPromise = null;

    const cacheControl = data.total < 100 
      ? 'no-store, max-age=0' 
      : 'public, s-maxage=30, stale-while-revalidate=60';

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': cacheControl,
      },
    });
  } catch (error) {
    console.error('Flight fetch error:', error);
    fetchPromise = null;
    return NextResponse.json(
      { error: 'Failed to fetch flight data' },
      { status: 500 }
    );
  }
}

function aggregateJamming(points: any[], threshold: number) {
  if (points.length === 0) return [];
  const grid = new Map<string, { lat: number; lng: number; count: number; total_nac_p: number }>();
  const GRID_SIZE = 2; // degrees

  for (const p of points) {
    const gLat = Math.floor(p.lat / GRID_SIZE) * GRID_SIZE;
    const gLng = Math.floor(p.lng / GRID_SIZE) * GRID_SIZE;
    const key = `${gLat},${gLng}`;

    if (!grid.has(key)) {
      grid.set(key, { lat: gLat + GRID_SIZE / 2, lng: gLng + GRID_SIZE / 2, count: 0, total_nac_p: 0 });
    }
    const cell = grid.get(key)!;
    cell.count++;
    cell.total_nac_p += p.nac_p;
  }

  return Array.from(grid.values())
    .filter(z => z.count >= 3) // Minimum 3 aircraft with degraded NACp
    .map(z => ({
      lat: z.lat,
      lng: z.lng,
      severity: Math.round((1 - (z.total_nac_p / z.count) / threshold) * 100),
      count: z.count,
    }));
}

