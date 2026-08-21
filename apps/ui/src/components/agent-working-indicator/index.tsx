import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import styles from './style.module.css';
import type { CSSProperties } from 'react';

const WORKING_SPARKLES = [
	{ x: -4, drift: -8, rise: 25, size: 1.5, blur: 0.2, duration: 4.8, delay: -0.3 },
	{ x: 4, drift: 7, rise: 30, size: 1, blur: 0.5, duration: 5.7, delay: -2.4 },
	{ x: -7, drift: 3, rise: 21, size: 1, blur: 0.3, duration: 4.3, delay: -1.1 },
	{ x: 7, drift: -5, rise: 27, size: 1.5, blur: 0.7, duration: 6.1, delay: -4.2 },
	{ x: -2, drift: 9, rise: 34, size: 1, blur: 0.6, duration: 6.6, delay: -3.1 },
	{ x: 3, drift: -7, rise: 23, size: 1.5, blur: 0.3, duration: 5.2, delay: -1.8 },
	{ x: -6, drift: -3, rise: 31, size: 1, blur: 0.9, duration: 7.1, delay: -5.6 },
	{ x: 6, drift: 5, rise: 26, size: 1, blur: 0.4, duration: 5.9, delay: -3.8 },
];

/**
 * The canonical agent "working" mark, shared by sidebar and conversation.
 */
export function AgentWorkingIndicator( {
	className,
	label = __( 'Working…' ),
	ambient = false,
}: {
	className?: string;
	label?: string | null;
	ambient?: boolean;
} ) {
	return (
		<span
			className={ clsx( styles.root, className ) }
			role={ label ? 'status' : undefined }
			aria-label={ label ?? undefined }
			aria-hidden={ label ? undefined : 'true' }
		>
			<span className={ styles.animation }>
				{ Array.from( { length: 6 }, ( _, index ) => (
					<span key={ index } className={ styles.cell }>
						<span className={ styles.pulse } />
					</span>
				) ) }
				{ ambient
					? WORKING_SPARKLES.map( ( sparkle, index ) => (
							<span
								key={ index }
								className={ styles.sparkle }
								style={
									{
										'--sparkle-x': `${ sparkle.x }px`,
										'--sparkle-drift': `${ sparkle.drift }px`,
										'--sparkle-drift-near': `${ sparkle.drift * 0.35 }px`,
										'--sparkle-drift-far': `${ sparkle.drift * -0.2 }px`,
										'--sparkle-rise': `${ sparkle.rise }px`,
										'--sparkle-size': `${ sparkle.size }px`,
										'--sparkle-blur': `${ sparkle.blur }px`,
										'--sparkle-duration': `${ sparkle.duration }s`,
										'--sparkle-delay': `${ sparkle.delay }s`,
									} as CSSProperties
								}
							>
								<span className={ styles.sparklePulse } />
							</span>
					  ) )
					: null }
			</span>
		</span>
	);
}
