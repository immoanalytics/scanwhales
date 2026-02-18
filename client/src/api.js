const BASE = '/api';

async function apiFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

export function getStats() {
  return apiFetch('/stats');
}

export function getTrades(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') qs.set(k, v);
  }
  return apiFetch(`/trades?${qs}`);
}

export function getWhales(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') qs.set(k, v);
  }
  return apiFetch(`/whales?${qs}`);
}

export function getWhale(address) {
  return apiFetch(`/whales/${address}`);
}

export function updateWhale(address, data) {
  return apiFetch(`/whales/${address}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function getWhalePositions(address) {
  return apiFetch(`/whales/${address}/positions`);
}

export function getSettings() {
  return apiFetch('/settings');
}

export function updateSettings(data) {
  return apiFetch('/settings', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function getCoins() {
  return apiFetch('/coins');
}
