// theme.ts — Data-driven skin/theme engine for the Singularity TUI.
//
// Mirrors the Hermes `skin_engine.py` pattern: skins are pure data, no code
// changes needed to add a new one.  Config path ~/.singularity/config.json
// carries a `skin: "name"` field; missing values inherit from DEFAULT_SKIN.

import { readFileSync } from 'node:fs';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ThemeColors {
  primary: string;
  secondary: string;
  accent: string;
  muted: string;
  bg: string;
  surface: string;
  border: string;
  error: string;
  success: string;
}

export interface Skin {
  name: string;
  colors: ThemeColors;
  compact?: boolean;
}

// ── Built-in skins ───────────────────────────────────────────────────────────

export const SKINS: Record<string, Skin> = {
  sisyphus: {
    name: 'sisyphus',
    colors: {
      primary: '#FFD700',
      secondary: '#CD7F32',
      accent: '#8B4513',
      muted: '#888888',
      bg: '#0d0d0d',
      surface: '#1a1a1a',
      border: '#CD7F32',
      error: '#ff6b6b',
      success: '#51cf66',
    },
  },

  ocean: {
    name: 'ocean',
    colors: {
      primary: '#74c0fc',
      secondary: '#4dabf7',
      accent: '#1c7ed6',
      muted: '#888888',
      bg: '#0d1117',
      surface: '#161b22',
      border: '#4dabf7',
      error: '#ff6b6b',
      success: '#51cf66',
    },
  },

  forest: {
    name: 'forest',
    colors: {
      primary: '#8ce99a',
      secondary: '#69db7c',
      accent: '#40c057',
      muted: '#888888',
      bg: '#0d1117',
      surface: '#161b22',
      border: '#40c057',
      error: '#ff6b6b',
      success: '#51cf66',
    },
  },

  mono: {
    name: 'mono',
    colors: {
      primary: '#ffffff',
      secondary: '#cccccc',
      accent: '#999999',
      muted: '#555555',
      bg: '#000000',
      surface: '#111111',
      border: '#333333',
      error: '#ff6b6b',
      success: '#51cf66',
    },
  },
};

export const DEFAULT_SKIN: Skin = SKINS.sisyphus;

// ── Config loading ─────────────────────────────────────────────────────────────

interface ConfigJson {
  skin?: string;
}

const CONFIG_PATH = `${process.env.HOME ?? '/root'}/.singularity/config.json`;

export function loadSkinNameFromConfig(): string | undefined {
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as ConfigJson;
    return parsed.skin;
  } catch {
    return undefined;
  }
}

export function getSkin(name?: string): Skin {
  if (!name) return DEFAULT_SKIN;
  return SKINS[name] ?? DEFAULT_SKIN;
}

export function loadSkinFromConfig(): Skin {
  return getSkin(loadSkinNameFromConfig());
}
