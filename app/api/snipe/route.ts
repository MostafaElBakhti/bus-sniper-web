import { NextRequest } from 'next/server';

const BASE = "https://bus-med.1337.ma";
const CURRENT_URL = `${BASE}/api/departure/current`;
const UPCOMING_URL = `${BASE}/api/departure/upcoming`;

function normalizeTime(t?: string): string | null {
  if (!t) return null;
  // If format is HH:MM:SS or HH:MM, return HH:MM
  const m = t.match(/(\d{2}:\d{2})(:\d{2})?/);
  if (m) return m[1];
  // If ISO timestamp, extract time
  const isoMatch = t.match(/\d{2}:\d{2}:\d{2}/);
  if (isoMatch) return isoMatch[0].slice(0,5);
  return t;
}

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

export async function POST(req: NextRequest) {
  try {
    const { token } = await req.json();
    if (!token) {
      return new Response(JSON.stringify({ error: 'token required' }), { status: 400 });
    }

    const headers = {
      'User-Agent': 'Mozilla/5.0 (bus-sniper-web)',
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Origin': BASE,
      'Referer': `${BASE}/home`,
      'Cookie': `le_token=${token}`,
    };

    const byCity: Record<string, string[]> = {};
    const globalTimes: string[] = [];
    const citySet: string[] = [];

    // Fetch UPCOMING
    try {
      const rUp = await fetch(UPCOMING_URL, { headers });
      if (rUp.ok) {
        const data = await rUp.json();
        if (Array.isArray(data)) {
          for (const item of data) {
            const name = (item.name || item.route?.name || '').trim();
            const dep = normalizeTime(item.departure_time || item.available_time || item.route?.departure_time);
            if (!name) continue;
            if (!byCity[name]) byCity[name] = [];
            if (dep) {
              byCity[name].push(dep);
              globalTimes.push(dep);
            }
            citySet.push(name);
          }
        }
      }
    } catch (e) {
      // ignore upstream errors for now, we'll still try CURRENT
    }

    // Fetch CURRENT (sometimes routes are present here)
    try {
      const rCur = await fetch(CURRENT_URL, { headers });
      if (rCur.ok) {
        const data = await rCur.json();
        if (Array.isArray(data)) {
          for (const item of data) {
            const routeName = (item.route?.name || item.name || '').trim();
            const dep = normalizeTime(item.route?.departure_time || item.departure_time);
            if (!routeName) continue;
            if (!byCity[routeName]) byCity[routeName] = [];
            if (dep) {
              byCity[routeName].push(dep);
              globalTimes.push(dep);
            }
            citySet.push(routeName);
          }
        }
      }
    } catch (e) {
      // ignore
    }

    // normalize results
    for (const k of Object.keys(byCity)) {
      byCity[k] = uniq(byCity[k]).sort();
    }
    const cities = uniq(citySet).sort();
    const times = uniq(globalTimes).sort();

    return new Response(JSON.stringify({ cities, times, byCity }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 500 });
  }
}