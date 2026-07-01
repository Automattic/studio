/**
 * Shared formatting helpers for Ink UI components.
 */

export function platformColor(platform: string): string {
  switch (platform) {
    case 'wix': return 'yellow';
    case 'squarespace': return 'white';
    case 'webflow': return 'blue';
    case 'shopify': return 'green';
    default: return 'gray';
  }
}

export function pluralize(word: string, count: number): string {
  if (count === 1) return word;
  if (word.endsWith('y') && !/[aeiou]y$/i.test(word)) {
    return word.slice(0, -1) + 'ies';
  }
  return word + 's';
}

export function confidenceBadge(confidence: string): string {
  switch (confidence) {
    case 'high': return '●';
    case 'medium': return '◐';
    case 'low': return '○';
    default: return '?';
  }
}
