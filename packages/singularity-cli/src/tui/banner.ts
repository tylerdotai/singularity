// banner.ts — Unicode logo art and wordmark for the Singularity TUI.
//
// LOGO_ART: 5-line "SINGULARITY" rendered in Unicode block characters.
//   11 letters (S I N G U L A R I T Y), each occupying 3 columns,
//   separated by 1 column of space = 43 columns wide.
//
//   Legend (per letter-slot, top to bottom):
//     ░ = light fill  ▓ = medium fill  █ = heavy stroke
//
// WORDMARK: compact single-line fallback for narrow terminals or compact mode.
//
// EMBLEM_ART: 5-line stylized "S" monogram using box-drawing characters.
//   Elegant and minimal — a tasteful abstract singularity / gravitational S.

export const LOGO_ART: readonly string[] = [
  // S    I    N    G    U    L    A    R    I    T    Y
  '░░░ ███ █▓░ █▓░ █░█ ███ ░▓░ █▓░ ███ ███ █▓█',
  '░▓░ ███ ░▓░ ░░▓ ░░█ ███ ███ █ █ ░██ ░██ ░▓░',
  '▓▓░ ███ ░▓░ ░▓░ ░░█ ███ ███ ██▓ ░██ ░██ ░▓░',
  '░▓░ ███ ░▓░ ░░▓ ░░█ ███ ███ █ ░ ░██ ░██ ░▓░',
  '░░░ ███ █▓█ █▓▓ █░█ ███ ███ █ ░ ███ ███ ░▓░',
] as const;

export const WORDMARK = ' singularity ';

export const EMBLEM_ART: readonly string[] = [
  '╔═══╗',
  '║   ║',
  ' ╚═══╝',
  '    ║',
  '    ╝',
] as const;
