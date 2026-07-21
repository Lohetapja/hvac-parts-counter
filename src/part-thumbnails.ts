// Generic, self-drawn SVG thumbnails for part categories. No scraped or commercial
// product imagery — these are schematic line glyphs that inherit currentColor.

type Shape = 'round' | 'rectangular' | 'both';

function wrap(inner: string): string {
  return `<svg viewBox="0 0 48 30" xmlns="http://www.w3.org/2000/svg" class="part-thumb-svg" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

const GLYPHS: Record<string, string> = {
  'duct-round': '<line x1="4" y1="15" x2="44" y2="15"/><ellipse cx="6" cy="15" rx="2.4" ry="6"/><ellipse cx="42" cy="15" rx="2.4" ry="6"/>',
  'duct-rect': '<rect x="5" y="8" width="38" height="14" rx="1"/><line x1="5" y1="15" x2="43" y2="15" stroke-dasharray="3 3"/>',
  'bend-round': '<path d="M6 24 L6 15 A9 9 0 0 1 15 6 L24 6"/><path d="M12 24 L12 18 A6 6 0 0 1 18 12 L24 12"/>',
  'bend-rect': '<path d="M8 24 L8 12 L24 12"/><path d="M14 24 L14 18 L24 18"/>',
  transition: '<path d="M6 6 L6 24 L20 20 L20 10 Z"/><path d="M20 10 L42 13 L42 17 L20 20"/>',
  branch: '<line x1="4" y1="20" x2="44" y2="20"/><path d="M24 20 L24 8"/><path d="M20 12 L24 8 L28 12"/>',
  tee: '<line x1="4" y1="20" x2="44" y2="20"/><line x1="24" y1="20" x2="24" y2="6"/>',
  terminal: '<rect x="8" y="8" width="24" height="14" rx="1"/><path d="M32 15 L42 10 L42 20 Z"/>',
  'cleaning-hatch': '<rect x="6" y="9" width="36" height="12" rx="1"/><rect x="18" y="6" width="12" height="7" rx="1"/>',
  damper: '<circle cx="24" cy="15" r="10"/><line x1="17" y1="22" x2="31" y2="8"/>',
  silencer: '<rect x="5" y="8" width="38" height="14" rx="6"/><line x1="14" y1="8" x2="14" y2="22"/><line x1="24" y1="8" x2="24" y2="22"/><line x1="34" y1="8" x2="34" y2="22"/>',
  continuation: '<line x1="24" y1="26" x2="24" y2="8"/><path d="M18 14 L24 8 L30 14"/>',
  boundary: '<line x1="24" y1="4" x2="24" y2="26"/><line x1="14" y1="8" x2="34" y2="22" stroke-dasharray="2 2"/><line x1="34" y1="8" x2="14" y2="22" stroke-dasharray="2 2"/>',
  custom: '<rect x="7" y="7" width="34" height="16" rx="2" stroke-dasharray="3 2"/><line x1="16" y1="15" x2="32" y2="15"/>',
};

export function partThumbnail(category: string, shape: Shape, size = ''): string {
  const round = shape === 'round' || /^Ø/.test(size);
  const key = ((): string => {
    switch (category) {
      case 'Duct': return round ? 'duct-round' : 'duct-rect';
      case 'Bend': return round ? 'bend-round' : 'bend-rect';
      case 'Transition': return 'transition';
      case 'Branch': return /t-?piece/i.test(size) ? 'tee' : 'branch';
      case 'Terminal': return 'terminal';
      case 'Access': return 'cleaning-hatch';
      case 'Damper': return 'damper';
      case 'Silencer': return 'silencer';
      case 'Continuation': return 'continuation';
      case 'Boundary': return 'boundary';
      default: return 'custom';
    }
  })();
  return wrap(GLYPHS[key] ?? GLYPHS.custom);
}
