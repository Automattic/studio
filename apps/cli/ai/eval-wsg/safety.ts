/**
 * Safety guards for the WSG eval harness.
 *
 * The harness creates and DELETES throwaway sites. Every name it generates is
 * prefixed with `wsg-eval-`, and deletion is gated on that prefix so the
 * harness can never delete a real user site even if a spec is misconfigured.
 */

export const EVAL_SITE_PREFIX = 'wsg-eval-';

/**
 * Only sites the harness created (prefixed `wsg-eval-`) may be deleted. Any
 * other name is refused. This is the single chokepoint the teardown path calls
 * before `site_delete`.
 */
export function isDeletableEvalSite( name: string ): boolean {
	return (
		typeof name === 'string' &&
		name.startsWith( EVAL_SITE_PREFIX ) &&
		name.length > EVAL_SITE_PREFIX.length
	);
}

/**
 * Build a deterministic throwaway site name from a case id and run id. The
 * result is lowercased and stripped to the slug charset `site_create` expects,
 * and always carries the `wsg-eval-` prefix.
 */
export function evalSiteName( caseId: string, runId: string ): string {
	const slugify = ( value: string ): string =>
		value
			.toLowerCase()
			.replace( /[^a-z0-9]+/g, '-' )
			.replace( /^-+|-+$/g, '' );
	const base = slugify( caseId ) || 'case';
	const run = slugify( runId ) || 'run';
	return `${ EVAL_SITE_PREFIX }${ base }-${ run }`;
}
