import { NextRequest } from 'next/server';

const BASE = "https://bus-med.1337.ma";
const CURRENT_URL = `${BASE}/api/departure/current`;
const UPCOMING_URL = `${BASE}/api/departure/upcoming`;
const BOOK_URL = `${BASE}/api/tickets/book`;

const NORMAL_POLL = 2.0;
const START_BEFORE = 0.5;
const SNIPER_WINDOW = 3.0;
const SNIPER_INTERVAL = 0.12;
const FAST_BOOK_WINDOW = 3.0;
const MAX_429 = 4;

interface SnipeRequest {
  token: string;
  city: string;
  departureTime: string;
}

function createSSE(data: any): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseTimeToday(timeStr: string): Date {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function findUpcoming(data: any[], city: string, depTime: string) {
  return data.find(d => {
    const name = d.name || '';
    const depTimeStr = d.departure_time || '';
    return name.toLowerCase().includes(city.toLowerCase()) && 
           depTimeStr.startsWith(depTime);
  });
}

function findCurrent(data: any[], city: string, depTime: string) {
  return data.find(d => {
    const route = d.route || {};
    const routeName = route.name || '';
    const routeDepTime = route.departure_time || '';
    return routeName.toLowerCase().includes(city.toLowerCase()) && 
           routeDepTime.startsWith(depTime);
  });
}

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  const { token, city, departureTime }: SnipeRequest = await req.json();

  let requestCount = 0;
  let pollCount = 0;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: any) => {
        controller.enqueue(encoder.encode(createSSE(data)));
      };

      const log = (message: string, level: string = 'info') => {
        send({ type: 'log', message, level });
      };

      const updateStats = () => {
        send({ type: 'stats', stats: { requests: requestCount, polls: pollCount } });
      };

      const headers = {
        'User-Agent': 'Mozilla/5.0 (bus-sniper-web)',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Origin': BASE,
        'Referer': `${BASE}/home`,
        'Cookie': `le_token=${token}`,
      };

      async function bookOnce(depId: number): Promise<[number | null, number]> {
        requestCount++;
        updateStats();
        const t0 = Date.now();
        try {
          const response = await fetch(BOOK_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify({ departure_id: depId, to_campus: false }),
          });
          const latency = Date.now() - t0;
          return [response.status, latency];
        } catch (error) {
          const latency = Date.now() - t0;
          return [null, latency];
        }
      }

      async function aggressiveBook(depId: number, openDt: Date): Promise<boolean> {
        log(`🔥 START BOOKING id=${depId}`, 'warning');
        const endTime = Date.now() + FAST_BOOK_WINDOW * 1000;
        let c429 = 0;

        while (Date.now() < endTime) {
          const [status, latency] = await bookOnce(depId);
          log(`➡️ POST | status=${status} | latency=${latency}ms`);

          if (status === 201) {
            const now = new Date();
            const offset = (now.getTime() - openDt.getTime()) / 1000;
            log(
              `✅ BOOKED at ${now.toLocaleTimeString()} | offset=${offset.toFixed(3)}s | latency=${latency}ms`,
              'success'
            );
            send({ type: 'success', message: `Successfully booked! Offset: ${offset.toFixed(3)}s` });
            return true;
          }

          if (status === 401 || status === 403) {
            log('❌ AUTH ERROR', 'error');
            send({ type: 'error', message: 'Authentication failed. Check your token.' });
            return false;
          }

          if (status === 429) {
            c429++;
            log(`⚠️ 429 Rate limit (${c429})`, 'warning');
            if (c429 >= MAX_429) {
              log('🛑 STOP (rate limit)', 'error');
              send({ type: 'error', message: 'Rate limited. Try again later.' });
              return false;
            }
          }

          await sleep(80 + Math.random() * 50);
        }

        log('❌ Booking window missed', 'error');
        return false;
      }

      // Main loop
      try {
        while (true) {
          // Check CURRENT
          log('🔎 Checking CURRENT...');
          pollCount++;
          updateStats();

          try {
            const rCur = await fetch(CURRENT_URL, { headers });
            if (rCur.ok) {
              const data = await rCur.json();
              const found = findCurrent(data, city, departureTime);
              if (found) {
                log('🚀 FOUND in CURRENT (immediate)', 'success');
                const success = await aggressiveBook(found.id, new Date());
                if (success) {
                  controller.close();
                  return;
                }
              }
            }
          } catch (error: any) {
            log(`⚠️ CURRENT error: ${error.message}`, 'warning');
          }

          // Check UPCOMING
          log('📡 Checking UPCOMING...');
          pollCount++;
          updateStats();

          try {
            const rUp = await fetch(UPCOMING_URL, { headers });
            if (rUp.ok) {
              const data = await rUp.json();
              const target = findUpcoming(data, city, departureTime);
              
              if (target) {
                const availableTime = target.available_time;
                const openDt = parseTimeToday(availableTime);
                const secondsUntil = (openDt.getTime() - Date.now()) / 1000;

                log(`🎯 UPCOMING | opens at ${availableTime} | in ${secondsUntil.toFixed(3)}s`);

                if (secondsUntil <= 0) {
                  log('⚠️ Booking time already passed', 'warning');
                  await sleep(30000);
                  continue;
                }

                const wakeAt = secondsUntil - START_BEFORE;
                if (wakeAt > 0) {
                  log(`😴 Sleeping ${wakeAt.toFixed(3)}s (before sniper)`);
                  await sleep(wakeAt * 1000);
                }

                // SNIPER MODE
                log('🔥 SNIPER MODE', 'warning');
                const sniperStart = Date.now();
                const deadline = Date.now() + SNIPER_WINDOW * 1000;
                let polls = 0;

                while (Date.now() < deadline) {
                  polls++;
                  pollCount++;
                  updateStats();

                  const rCur2 = await fetch(CURRENT_URL, { headers });
                  if (rCur2.ok) {
                    const data2 = await rCur2.json();
                    const found2 = findCurrent(data2, city, departureTime);
                    if (found2) {
                      const detectAfter = (Date.now() - sniperStart) / 1000;
                      log(`👀 CURRENT detected after ${detectAfter.toFixed(3)}s | polls=${polls}`, 'success');
                      const success = await aggressiveBook(found2.id, openDt);
                      if (success) {
                        controller.close();
                        return;
                      }
                    }
                  }

                  await sleep(SNIPER_INTERVAL * 1000 + Math.random() * 30);
                }

                log('❌ SNIPER window ended', 'warning');
                await sleep(300);
              } else {
                log('⏳ Target not in UPCOMING yet');
                await sleep(NORMAL_POLL * 1000);
              }
            }
          } catch (error: any) {
            log(`⚠️ UPCOMING error: ${error.message}`, 'warning');
          }

          await sleep(NORMAL_POLL * 1000);
        }
      } catch (error: any) {
        log(`❌ Fatal error: ${error.message}`, 'error');
        send({ type: 'error', message: error.message });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}