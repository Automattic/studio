import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import styles from './style.module.css';
import type { CSSProperties } from 'react';

// Per-cell breathing timings. The durations are deliberately all different
// (and non-multiples): with a shared period, any set of phase offsets is a
// standing wave and the eye reads it as a chase. Distinct periods make the
// cells drift in and out of phase forever, so no sequence ever repeats.
const BREATHE_TIMINGS = [
	{ duration: 2.2, phase: 0.1 },
	{ duration: 2.9, phase: 0.6 },
	{ duration: 2.5, phase: 0.35 },
	{ duration: 3.3, phase: 0.8 },
	{ duration: 2.7, phase: 0 },
	{ duration: 3.1, phase: 0.5 },
];

/**
 * The agent's "working" mark: a 2×3 grid of brand-blue pixels that breathe
 * out of phase with one another — same square-pixel language as the W
 * particle toy on empty chats. Size via the `--agent-pixel-size` /
 * `--agent-pixel-gap` custom properties.
 */
export function AgentWorkingIndicator( {
	className,
	label = __( 'Working…' ),
}: {
	className?: string;
	label?: string;
} ) {
	return (
		<span className={ clsx( styles.grid, className ) } role="status" aria-label={ label }>
			{ BREATHE_TIMINGS.map( ( { duration, phase }, cellIndex ) => (
				<span
					key={ cellIndex }
					className={ styles.pixel }
					style={
						{
							'--breathe-duration': `${ duration }s`,
							'--breathe-delay': `${ -phase * duration }s`,
						} as CSSProperties
					}
				/>
			) ) }
		</span>
	);
}
