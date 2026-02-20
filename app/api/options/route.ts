import { NextRequest } from 'next/server';

const BASE = "https://bus-med.1337.ma";
const CURRENT_URL = `${BASE}/api/departure/current`;
const UPCOMING_URL = `${BASE}/api/departure/upcoming`;

function normalizeTime(t?: string): string | null {
  if (!t) return null;
  const m = t.match(/(\d{2}:\d{2})(:\d{2})?/);
  if (m) return m[1];
  const isoMatch = t?.match(/\d{2}:\d{2}:\d{2}/);
  if (isoMatch) return isoMatch[0].slice(0, 5);
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

    const headers: Record<string, string> = {
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

    const safeFetchJson = async (url: string) => {
      try {
        const r = await fetch(url, { headers });
        if (!r.ok) return null;
        return await r.json();
      } catch {
        return null;
      }
    };

    const up = await safeFetchJson(UPCOMING_URL);
    if (Array.isArray(up)) {
      for (const item of up) {
        const name = (item.name || item.route?.name || '').trim();
        const dep = normalizeTime(item.departure_time || item.available_time || item.route?.departure_time);
        if (!name) continue;
        byCity[name] ??= [];
        if (dep) {
          byCity[name].push(dep);
          globalTimes.push(dep);
        }
        citySet.push(name);
      }
    }

    const cur = await safeFetchJson(CURRENT_URL);
    if (Array.isArray(cur)) {
      for (const item of cur) {
        const name = (item.route?.name || item.name || '').trim();
        const dep = normalizeTime(item.route?.departure_time || item.departure_time);
        if (!name) continue;
        byCity[name] ??= [];
        if (dep) {
          byCity[name].push(dep);
          globalTimes.push(dep);
        }
        citySet.push(name);
      }
    }

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