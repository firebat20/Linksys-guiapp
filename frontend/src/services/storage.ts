export const HOST_HISTORY_KEY = 'linkbooter_host_history';
export const SAVED_PASSWORDS_KEY = 'linkbooter_saved_passwords';
export const MAX_HISTORY = 5;

export function normalizeHostKey(host: string): string {
  if (!host) return '';
  return host.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

export function loadHostHistory(): string[] {
  try {
    const raw = localStorage.getItem(HOST_HISTORY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((h: unknown): h is string => typeof h === 'string' && h.trim().length > 0);
      }
    }
  } catch {
    /* ignore corrupt data */
  }
  return ['192.168.1.1'];
}

export function saveHostHistory(hosts: string[]): void {
  try {
    localStorage.setItem(HOST_HISTORY_KEY, JSON.stringify(hosts.slice(0, MAX_HISTORY)));
  } catch {
    /* ignore storage errors */
  }
}

export function addToHostHistory(host: string, current: string[]): string[] {
  const trimmed = host.trim();
  const normalized = normalizeHostKey(trimmed);
  if (!normalized) return current;
  const filtered = current.filter((h) => normalizeHostKey(h) !== normalized);
  return [trimmed, ...filtered].slice(0, MAX_HISTORY);
}

export function loadSavedPasswords(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SAVED_PASSWORDS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, string>;
      }
    }
  } catch {
    /* ignore corrupt data */
  }
  return {};
}

export function getSavedPassword(host: string): string | null {
  const normalized = normalizeHostKey(host);
  if (!normalized) return null;
  const passwords = loadSavedPasswords();
  return typeof passwords[normalized] === 'string' ? passwords[normalized] : null;
}

export function savePassword(host: string, password: string): void {
  const normalized = normalizeHostKey(host);
  if (!normalized) return;
  try {
    const passwords = loadSavedPasswords();
    passwords[normalized] = password;
    localStorage.setItem(SAVED_PASSWORDS_KEY, JSON.stringify(passwords));
  } catch {
    /* ignore storage errors */
  }
}

export function removeSavedPassword(host: string): void {
  const normalized = normalizeHostKey(host);
  if (!normalized) return;
  try {
    const passwords = loadSavedPasswords();
    if (normalized in passwords) {
      delete passwords[normalized];
      localStorage.setItem(SAVED_PASSWORDS_KEY, JSON.stringify(passwords));
    }
  } catch {
    /* ignore storage errors */
  }
}
