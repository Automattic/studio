//
// design-foundation.md renderer.
// ==============================
// Pure function: (DesignFoundation) → markdown string. Walks roles in schema
// declaration order for stable diffs. Escapes markdown-meaningful chars in
// values. Rejects/escapes `../` in evidence image paths (no directory
// traversal via image link).
//
import type { DesignFoundation, Role, Gradient } from './schema.js';

// Roles are rendered in this order (matches schema declaration order). Stable
// for diffing.
const COLOR_GROUPS = ['surface', 'text', 'accent', 'border'] as const;

export function renderMd(f: DesignFoundation): string {
  const lines: string[] = [];

  lines.push(`# Design Foundation — ${f.origin}`);
  lines.push('');
  lines.push(`Generated: ${f.generatedAt}`);
  lines.push('');
  lines.push(`Inputs digest: palette=${truncSha(f.inputsDigest.palette)}, typography=${truncSha(f.inputsDigest.typography)}, breakpoints=${truncSha(f.inputsDigest.breakpoints)}, manifest=${truncSha(f.inputsDigest.manifest)}`);
  lines.push('');

  lines.push('## Color');
  lines.push('');
  for (const group of COLOR_GROUPS) {
    const roles = f.color[group];
    const keys = Object.keys(roles);
    if (keys.length === 0) continue;
    for (const key of keys) {
      renderRole(lines, `color.${group}.${key}`, roles[key]);
    }
  }

  lines.push('## Gradient');
  lines.push('');
  for (const [key, g] of Object.entries(f.gradient)) {
    renderGradient(lines, `gradient.${key}`, g);
  }

  lines.push('## Typography');
  lines.push('');
  for (const [key, role] of Object.entries(f.typography.families)) {
    renderRole(lines, `typography.families.${key}`, role);
  }
  lines.push(`**Scale base:** \`${escapeInlineCode(f.typography.scale.base)}\`${f.typography.scale.ratio ? ` · ratio ${f.typography.scale.ratio}` : ''}`);
  lines.push('');
  lines.push(`**Scale steps:** ${Object.entries(f.typography.scale.steps).map(([k, v]) => `\`${escapeInlineCode(k)}\`=\`${escapeInlineCode(v)}\``).join(', ')}`);
  lines.push('');
  lines.push(`**Weights:** ${f.typography.weights.join(', ')}`);
  lines.push('');

  lines.push('## Spacing');
  lines.push('');
  lines.push(`**Base:** \`${escapeInlineCode(f.spacing.base)}\``);
  lines.push('');
  lines.push(`**Scale:** ${Object.entries(f.spacing.scale).map(([k, v]) => `\`${escapeInlineCode(k)}\`=\`${escapeInlineCode(v)}\``).join(', ')}`);
  lines.push('');
  lines.push(`**Sections:** padY \`${escapeInlineCode(f.spacing.sections.padY)}\`, padX \`${escapeInlineCode(f.spacing.sections.padX)}\`, contentMaxWidth \`${escapeInlineCode(f.spacing.sections.contentMaxWidth)}\``);
  lines.push('');

  lines.push('## Breakpoints');
  lines.push('');
  for (const key of ['sm', 'md', 'lg', 'xl'] as const) {
    const v = f.breakpoints[key];
    if (v) lines.push(`- \`${key}\` = \`${escapeInlineCode(v)}\``);
  }
  if (f.breakpoints.evidence.length > 0) {
    lines.push('');
    lines.push('**Evidence:**');
    for (const e of f.breakpoints.evidence) lines.push(`- ${escapeMd(e)}`);
  }
  lines.push('');

  lines.push('## Radius');
  lines.push('');
  for (const key of ['sm', 'base', 'lg'] as const) {
    const v = f.radius[key];
    if (v) lines.push(`- \`${key}\` = \`${escapeInlineCode(v)}\``);
  }
  if (f.radius.evidence.length > 0) {
    lines.push('');
    lines.push('**Evidence:**');
    for (const e of f.radius.evidence) lines.push(`- ${escapeMd(e)}`);
  }
  lines.push('');

  lines.push('## Components');
  lines.push('');
  for (const [name, tokens] of Object.entries(f.components)) {
    lines.push(`### ${escapeMd(name)}`);
    lines.push('');
    for (const [k, v] of Object.entries(tokens)) {
      lines.push(`- **${escapeMd(k)}:** \`${escapeInlineCode(String(v))}\``);
    }
    lines.push('');
  }

  if (f.openQuestions.length > 0) {
    lines.push('## Open questions');
    lines.push('');
    for (const q of f.openQuestions) {
      const blocker = q.blocksReplica ? ' **(blocks replica)**' : '';
      lines.push(`- \`${escapeInlineCode(q.id)}\`${blocker}: ${escapeMd(q.question)}`);
    }
    lines.push('');
  }

  if (f.skillTodos.length > 0) {
    lines.push('## Skill TODOs (unfilled slots)');
    lines.push('');
    for (const t of f.skillTodos) {
      lines.push(`- \`${escapeInlineCode(t)}\``);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function renderRole(lines: string[], path: string, role: Role): void {
  lines.push(`### ${escapeMd(path)}`);
  lines.push('');
  lines.push(`**Value:** \`${escapeInlineCode(role.value)}\``);
  lines.push('');
  lines.push(`**Role:** ${escapeMd(role.role)}`);
  lines.push('');
  lines.push('**Evidence:**');
  for (const e of role.evidence) {
    lines.push(`- ${renderEvidence(e)}`);
  }
  lines.push('');
}

function renderGradient(lines: string[], path: string, g: Gradient): void {
  lines.push(`### ${escapeMd(path)}`);
  lines.push('');
  lines.push(`**CSS:** \`${escapeInlineCode(g.css)}\``);
  lines.push('');
  lines.push(`**Role:** ${escapeMd(g.role)}`);
  lines.push('');
  lines.push('**Evidence:**');
  for (const e of g.evidence) {
    lines.push(`- ${renderEvidence(e)}`);
  }
  lines.push('');
}

// Evidence strings may include references to screenshot paths. Image syntax
// is opt-in: evidence ending in `.png` or `.jpg` gets rendered as an image.
// `../` is rejected outright (no directory traversal).
function renderEvidence(e: string): string {
  const trimmed = e.trim();
  // Reject attempts to reference files outside the site dir.
  if (trimmed.includes('../') || trimmed.startsWith('/')) {
    return escapeMd(e);
  }
  if (/\.(png|jpg|jpeg)$/i.test(trimmed)) {
    const safe = encodeURI(trimmed);
    return `\`${escapeInlineCode(e)}\`\n\n![${escapeMd(e)}](${safe})`;
  }
  return escapeMd(e);
}

function truncSha(s: string): string {
  const m = s.match(/^sha256:([a-f0-9]+)/);
  return m ? `sha256:${m[1].slice(0, 8)}` : s;
}

function escapeMd(s: string): string {
  // Escape characters that would alter markdown semantics outside code spans.
  return s.replace(/([\\`*_{}\[\]()#+\-!|>])/g, '\\$1');
}

function escapeInlineCode(s: string): string {
  // Inside inline code, only backticks are problematic. Replace with visually
  // similar char to avoid breaking the span.
  return s.replace(/`/g, '\u2018');
}
