'use client';

import { useState, useRef, useEffect } from 'react';

interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
}

type OptionsResponse = {
  cities: string[];
  times: string[]; // global list (not used directly)
  byCity: Record<string, string[]>;
};

export default function Home() {
  const [token, setToken] = useState('');
  const [city, setCity] = useState('');
  const [departureTime, setDepartureTime] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState({ requests: 0, polls: 0 });

  const [loadingOptions, setLoadingOptions] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [cities, setCities] = useState<string[]>([]);
  const [times, setTimes] = useState<string[]>([]);
  const [byCity, setByCity] = useState<Record<string, string[]>>({});

  const abortControllerRef = useRef<AbortController | null>(null);

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    const timestamp = new Date().toLocaleTimeString('en-GB', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
    setLogs(prev => [...prev, { timestamp, message, type }]);
  };

  // Load options (cities + times) from serverless proxy
  const loadOptions = async () => {
    setOptionsError(null);
    if (!token) {
      setOptionsError('Token is required to load options');
      return;
    }
    setLoadingOptions(true);
    try {
      const res = await fetch('/api/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      if (!res.ok) {
        const txt = await res.text();
        setOptionsError(`Failed to load options: ${res.status} ${txt}`);
        return;
      }

      const data: OptionsResponse = await res.json();
      setCities(data.cities || []);
      setTimes(data.times || []);
      setByCity(data.byCity || {});
      // Pre-select first city/time if present
      if (data.cities && data.cities.length > 0) {
        setCity(prev => prev || data.cities[0]);
        const defaultTimes = data.byCity?.[data.cities[0]] || data.times;
        if (defaultTimes && defaultTimes.length > 0) setDepartureTime(prev => prev || defaultTimes[0]);
      }
      addLog('Options loaded', 'success');
    } catch (err: any) {
      setOptionsError(String(err?.message || err));
    } finally {
      setLoadingOptions(false);
    }
  };

  // update times when city changes
  useEffect(() => {
    if (city && byCity[city]) {
      setDepartureTime(byCity[city][0] || '');
    }
  }, [city, byCity]);

  const startSniping = async () => {
    if (!token || !city || !departureTime) {
      addLog('Please fill all fields', 'error');
      return;
    }

    setIsRunning(true);
    setLogs([]);
    setStats({ requests: 0, polls: 0 });
    abortControllerRef.current = new AbortController();

    addLog(`🎯 Target: ${city} at ${departureTime}`, 'info');

    try {
      const response = await fetch('/api/snipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, city, departureTime }),
        signal: abortControllerRef.current.signal,
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        addLog('Failed to start streaming', 'error');
        setIsRunning(false);
        return;
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'log') {
                addLog(data.message, data.level || 'info');
              } else if (data.type === 'stats') {
                setStats(data.stats);
              } else if (data.type === 'success') {
                addLog(data.message, 'success');
                setIsRunning(false);
              } else if (data.type === 'error') {
                addLog(data.message, 'error');
                setIsRunning(false);
              }
            } catch (e) {
              console.error('Parse error:', e);
            }
          }
        }
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        addLog(`Error: ${error.message}`, 'error');
      }
    } finally {
      setIsRunning(false);
    }
  };

  const stopSniping = () => {
    abortControllerRef.current?.abort();
    setIsRunning(false);
    addLog('Stopped by user', 'warning');
  };

  const getLogColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'success': return 'text-green-400';
      case 'error': return 'text-red-400';
      case 'warning': return 'text-yellow-400';
      default: return 'text-gray-300';
    }
  };

  useEffect(() => {
    const logsContainer = document.getElementById('logs-container');
    if (logsContainer) {
      logsContainer.scrollTop = logsContainer.scrollHeight;
    }
  }, [logs]);

  const cityOptions = cities;
  const timeOptions = (city && byCity[city]) ? byCity[city] : times;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 p-4">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold text-white mb-8 text-center">
          🚌 Bus Sniper Bot
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Configuration Panel */}
          <div className="lg:col-span-1 bg-gray-800 rounded-lg p-6 shadow-xl">
            <h2 className="text-xl font-semibold text-white mb-4">Configuration</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Token
                </label>
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Enter token (le_token)"
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isRunning}
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={loadOptions}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-1 px-2 rounded-md transition duration-200 disabled:opacity-60"
                    disabled={loadingOptions || !token}
                  >
                    {loadingOptions ? 'Loading...' : 'Load options'}
                  </button>
                  <button
                    onClick={() => { setToken(''); setCities([]); setTimes([]); setByCity({}); setCity(''); setDepartureTime(''); }}
                    className="bg-gray-600 hover:bg-gray-700 text-white py-1 px-3 rounded-md"
                    disabled={isRunning}
                  >
                    Clear
                  </button>
                </div>
                {optionsError && <p className="text-red-400 text-sm mt-2">{optionsError}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  City
                </label>

                <select
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isRunning || cityOptions.length === 0}
                >
                  <option value="">{cityOptions.length ? 'Select a city' : 'No cities loaded'}</option>
                  {cityOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Departure Time
                </label>

                {/* if we have times use select, else fallback to time input */}
                {timeOptions && timeOptions.length > 0 ? (
                  <select
                    value={departureTime}
                    onChange={(e) => setDepartureTime(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={isRunning}
                  >
                    <option value="">{timeOptions.length ? 'Select time' : 'No times'}</option>
                    {timeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                ) : (
                  <input
                    type="time"
                    value={departureTime}
                    onChange={(e) => setDepartureTime(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={isRunning}
                  />
                )}
              </div>

              {!isRunning ? (
                <button
                  onClick={startSniping}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-md transition duration-200"
                >
                  🔥 Start Sniping
                </button>
              ) : (
                <button
                  onClick={stopSniping}
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-md transition duration-200"
                >
                  🛑 Stop
                </button>
              )}
            </div>

            {/* Stats */}
            <div className="mt-6 pt-6 border-t border-gray-700">
              <h3 className="text-sm font-medium text-gray-400 mb-3">Statistics</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Requests:</span>
                  <span className="text-white font-mono">{stats.requests}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Polls:</span>
                  <span className="text-white font-mono">{stats.polls}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Logs Panel */}
          <div className="lg:col-span-2 bg-gray-800 rounded-lg p-6 shadow-xl">
            <h2 className="text-xl font-semibold text-white mb-4">Activity Logs</h2>

            <div
              id="logs-container"
              className="bg-gray-900 rounded-md p-4 h-96 overflow-y-auto font-mono text-sm"
            >
              {logs.length === 0 ? (
                <p className="text-gray-500 text-center mt-8">
                  No activity yet. Configure and start sniping.
                </p>
              ) : (
                logs.map((log, index) => (
                  <div key={index} className="mb-1">
                    <span className="text-gray-500">[{log.timestamp}]</span>{' '}
                    <span className={getLogColor(log.type)}>{log.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Info Card */}
        <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-4">
          <h3 className="text-blue-300 font-semibold mb-2">ℹ️ How it works</h3>
          <ul className="text-blue-200 text-sm space-y-1">
            <li>• Enter your token from browser cookies (le_token)</li>
            <li>• Click "Load options" to fetch available cities and departure times</li>
            <li>• Select city and time, then click "Start Sniping"</li>
          </ul>
        </div>
      </div>
    </div>
  );
}