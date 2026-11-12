// Where the toolbar icon opens Sherlock, as in other wallets: Chrome's side panel (the default),
// or a popup under the icon. In popup mode dapp requests open windows; in side panel mode they show
// in the panel. The background applies the setting to the toolbar icon (see background/index.ts).

export type DisplayMode = 'panel' | 'popup';

const KEY = 'displayMode';

export const parseDisplayMode = (value: unknown): DisplayMode => (value === 'popup' ? 'popup' : 'panel');

export async function getDisplayMode(): Promise<DisplayMode> {
  return parseDisplayMode((await chrome.storage.local.get(KEY))[KEY]);
}

export const setDisplayMode = (mode: DisplayMode) => chrome.storage.local.set({ [KEY]: mode });

export function onDisplayModeChange(listener: (mode: DisplayMode) => void) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && KEY in changes) listener(parseDisplayMode(changes[KEY].newValue));
  });
}

// The built UI page: the side panel's, which is also what the popup and request windows load.
export function uiPagePath(): string {
  const manifest = chrome.runtime.getManifest() as chrome.runtime.ManifestV3 & {
    side_panel?: { default_path?: string };
  };
  return manifest.side_panel?.default_path ?? 'ui/popup.html';
}
