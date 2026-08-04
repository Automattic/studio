/**
 * Overall progress for `pull-reprint`.
 *
 * Reprint reports progress per sub-command ("42/1337 files"), with no notion
 * of how far through the whole pull that is. Studio drives the command as a
 * child process and scrapes a `(N%)` token out of the message to move its
 * progress bar (see `pullSite` in `packages/common/sites/sync.ts`), so each
 * step is mapped onto a slice of 0–100 and its own fraction interpolated
 * within that slice.
 *
 * The weights are rough — files dominate wall-clock on a typical site, the
 * database is a distant second — and they only need to be monotonic and
 * non-stalling, not accurate.
 */

/** A phase of the pull, in the order they run. */
export enum PullStep {
	SETUP = 'setup',
	PREFLIGHT = 'preflight',
	FILES = 'files',
	DATABASE = 'database',
	FLATTEN = 'flatten',
	RUNTIME = 'runtime',
	LINK = 'link',
	START = 'start',
	REMAINING = 'remaining',
}

/** `[start, end]` of each step's slice of the overall 0–100 range. */
const BANDS: Record< PullStep, readonly [ number, number ] > = {
	[ PullStep.SETUP ]: [ 0, 3 ],
	[ PullStep.PREFLIGHT ]: [ 3, 5 ],
	[ PullStep.FILES ]: [ 5, 55 ],
	[ PullStep.DATABASE ]: [ 55, 75 ],
	[ PullStep.FLATTEN ]: [ 75, 82 ],
	[ PullStep.RUNTIME ]: [ 82, 86 ],
	[ PullStep.LINK ]: [ 86, 88 ],
	[ PullStep.START ]: [ 88, 92 ],
	[ PullStep.REMAINING ]: [ 92, 100 ],
};

/**
 * Maps a step and its own 0–1 completion onto the overall percentage.
 *
 * `fraction` is clamped, so a reprint counter that overshoots or resets
 * mid-transfer can't push the bar past its band or backwards out of it.
 * Omitting it parks the bar at the start of the band, which is what the
 * steps that report no measurable progress do.
 */
export function overallPercent( step: PullStep, fraction?: number ): number {
	const [ start, end ] = BANDS[ step ];
	const clamped = Math.min( 1, Math.max( 0, fraction ?? 0 ) );
	return Math.round( start + ( end - start ) * clamped );
}

/**
 * Appends the `(N%)` token `pullSite` looks for. Matches the format the
 * `pull` command already emits, so both engines parse identically.
 */
export function withPercent( message: string, percent: number ): string {
	return `${ message } (${ percent }%)`;
}
