import { NextResponse } from 'next/server';
import { isSourceEnabled } from '@/config/featureFlags';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * KINTEL — Geopolitical Events Layer (GDACS / GDELT fallback)
 * Source: GDACS RSS (disaster/geopolitical events, geocoded)
 * Keyless public feed; updates ~15 min.
 * Response: { events: [{ id, lat, lng, name, url, type }] }
 * Gated by isSourceEnabled('gdelt').
 */

export async function GET(request: Request) {
  // Feature-flag gate — returns 403 if disabled
  if (!isSourceEnabled('gdelt')) {
    return NextResponse.json(
      { error: 'gdelt source is not enabled for this platform configuration.' },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  // q param reserved for future GDELT DOC API integration; currently unused
  void searchParams.get('q');

  try {
    const res = await fetch('https://www.gdacs.org/xml/rss.xml', {
      next: { revalidate: 900 }, // Cache 15 min — GDACS updates ~15 min
      headers: {
        'Accept': 'application/xml, text/xml, */*',
        'User-Agent': 'Kammandor Intel research contact@kammandor.com',
      },
    });

    if (!res.ok) {
      return NextResponse.json(
        { events: [], error: `GDACS API returned HTTP ${res.status}` },
        { status: 502 }
      );
    }

    const xml = await res.text();
    // Split by <item> instead of regex to avoid ReDoS on large XML
    const rawItems = xml.split(/<item>/i).slice(1);
    const allEvents: Array<{
      id: string;
      lat: number;
      lng: number;
      name: string;
      url: string;
      type: string;
      tone?: number;
      date?: string;
    }> = [];
    let eventId = 0;

    for (const rawItem of rawItems) {
      const item = rawItem.split(/<\/item>/i)[0];

      const titleMatch =
        item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i) ||
        item.match(/<title>(.*?)<\/title>/i);
      const linkMatch =
        item.match(/<link>(.*?)<\/link>/i);
      const latMatch =
        item.match(/<geo:lat>(.*?)<\/geo:lat>/i);
      const lngMatch =
        item.match(/<geo:long>(.*?)<\/geo:long>/i);
      const typeMatch =
        item.match(/<gdacs:eventtype>(.*?)<\/gdacs:eventtype>/i);
      const dateMatch =
        item.match(/<pubDate>(.*?)<\/pubDate>/i);
      // GDACS alertscore ranges -1..3; treat as proxy for tone (inverted: high = bad)
      const scoreMatch =
        item.match(/<gdacs:alertscore>(.*?)<\/gdacs:alertscore>/i);

      if (!titleMatch || !latMatch || !lngMatch) continue;

      const lat = parseFloat(latMatch[1]);
      const lng = parseFloat(lngMatch[1]);
      if (isNaN(lat) || isNaN(lng)) continue;

      const eventType = typeMatch ? typeMatch[1].toUpperCase() : 'UNK';
      let type = 'conflict';
      if (eventType === 'EQ') type = 'earthquake';
      else if (eventType === 'TC') type = 'weather';
      else if (eventType === 'FL') type = 'flood';
      else if (eventType === 'VO') type = 'volcano';
      else if (eventType === 'WF') type = 'wildfire';
      else if (eventType === 'DR') type = 'drought';

      const scoreRaw = scoreMatch ? parseFloat(scoreMatch[1]) : null;
      // Normalise: GDACS 0=green, 1=orange, 2=red → tone 0 (positive) .. -100 (negative)
      const tone = scoreRaw !== null && !isNaN(scoreRaw) ? -(scoreRaw / 3) * 100 : undefined;

      allEvents.push({
        id: `gdacs-${eventId++}`,
        lat,
        lng,
        name: titleMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim(),
        url: linkMatch ? linkMatch[1].trim() : '',
        type,
        ...(tone !== undefined ? { tone } : {}),
        date: dateMatch ? dateMatch[1].trim() : undefined,
      });
    }

    return NextResponse.json(
      {
        events: allEvents,
        total: allEvents.length,
        timestamp: new Date().toISOString(),
        source: 'GDACS RSS',
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800',
        },
      }
    );
  } catch (err) {
    console.warn('[KINTEL] gdelt/gdacs route error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { events: [], total: 0, error: 'Internal error fetching GDACS data' },
      { status: 500 }
    );
  }
}
