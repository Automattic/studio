/**
 * Resolve a dotted path ("color.accent.primary") to a Role-shaped value in
 * the foundation. Returns true iff the path exists and the role object has
 * non-empty value/role/evidence and no "TODO" sentinel. Used by the
 * design-foundation-validate handler's skillTodos check.
 */
export function pathResolvesToValidRole(f: unknown, dottedPath: string): boolean {
  const parts = dottedPath.split('.');
  let cur: unknown = f;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object') return false;
    cur = (cur as Record<string, unknown>)[p];
  }
  if (!cur || typeof cur !== 'object') return false;
  const role = cur as { value?: unknown; role?: unknown; evidence?: unknown; css?: unknown };
  const hasEvidence = Array.isArray(role.evidence) && role.evidence.length > 0;
  const hasValue = (typeof role.value === 'string' && role.value.length > 0 && role.value !== 'TODO')
    || (typeof role.css === 'string' && role.css.length > 0 && role.css !== 'TODO');
  const hasRole = typeof role.role === 'string' && role.role.length > 0 && role.role !== 'TODO';
  return hasEvidence && hasValue && hasRole;
}
