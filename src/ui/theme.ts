export type ThemeChoice = 'auto' | 'light' | 'dark';

// localStorage is shared by every page of the extension and readable synchronously, so each window
// can apply the theme before it first paints (no white flash in dark mode).
const KEY = 'Sherlock-theme';

// Dark (Jupiter colours) unless the user picked otherwise.
export function getTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'auto' ? value : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme: ThemeChoice = getTheme()) {
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function setTheme(theme: ThemeChoice) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Storage blocked: the choice still applies to this window.
  }
  applyTheme(theme);
}

// Other open Sherlock windows (inspector, approval) follow a change made in the settings.
export function followThemeChanges() {
  window.addEventListener('storage', (event) => {
    if (event.key === KEY || event.key === null) applyTheme();
  });
}
