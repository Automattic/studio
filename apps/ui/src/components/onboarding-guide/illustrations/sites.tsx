import { __ } from '@wordpress/i18n';
import { privateApis } from '@wordpress/theme';
import { clsx } from 'clsx';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { unlock } from '@/lock-unlock';
import { easings, envelope, sample, useTimeline, type Keyframe } from './choreography';
import { Cursor, Tooltip } from './primitives';
import styles from './style.module.css';
import type { CSSProperties } from 'react';

const { ThemeProvider } = unlock( privateApis );

// The sidebar sits on the dark window chrome in both color schemes, so this
// scene mirrors the sidebar-layout: a dark chrome background and a nested dark
// theme scope so the row's wpds tokens resolve against the dark ramp.
const CHROME_BG_LIGHT = '#1e1e1e';
const CHROME_BG_DARK = '#161616';

const LOOP = 11000;

// The pointer's path (offsets from the row centre): drift in → hover the
// overview button → move to the status button → press → hold while it starts →
// leave. Per-segment easing gives it a human cadence.
const CURSOR_PATH: Keyframe[] = [
	{ at: 0, x: 168, y: 96, scale: 1, opacity: 0, ease: easings.easeOut },
	{ at: 1100, x: 82, y: 8, scale: 1, opacity: 1, ease: easings.linear },
	{ at: 3080, x: 82, y: 8, scale: 1, opacity: 1, ease: easings.easeInOut },
	{ at: 4070, x: 108, y: 8, scale: 1, opacity: 1, ease: easings.easeIn },
	{ at: 4840, x: 108, y: 8, scale: 1, opacity: 1, ease: easings.easeIn },
	{ at: 5005, x: 108, y: 9, scale: 0.86, opacity: 1, ease: easings.easeOut },
	{ at: 5170, x: 108, y: 8, scale: 1, opacity: 1, ease: easings.linear },
	{ at: 8470, x: 108, y: 8, scale: 1, opacity: 1, ease: easings.easeIn },
	{ at: 9460, x: 170, y: 98, scale: 1, opacity: 0 },
	{ at: LOOP, x: 170, y: 98, scale: 1, opacity: 0 },
];

// Play triangle: shown while stopped, gone once the site starts, back in during
// the closing pause so the loop resets cleanly.
function playOpacity( t: number ): number {
	if ( t < 4840 ) {
		return 1;
	}
	if ( t < 5170 ) {
		return 1 - ( t - 4840 ) / 330;
	}
	if ( t < 10300 ) {
		return 0;
	}
	if ( t < 10800 ) {
		return ( t - 10300 ) / 500;
	}
	return 1;
}

// Status dot: fades in amber (starting, with a gentle pulse), switches to green
// (running), then fades out for the reset.
function statusDot( t: number ): { opacity: number; color: string } {
	let opacity = envelope( t, 4840, 330, 9900, 550 );
	if ( t > 5170 && t < 6820 ) {
		const phase = ( ( t - 5170 ) / 900 ) % 1;
		opacity *= 0.4 + 0.6 * Math.abs( 1 - 2 * phase );
	}
	const color =
		t < 7040 ? 'var(--studio-color-status-transitioning)' : 'var(--studio-color-status-running)';
	return { opacity, color };
}

function tooltipStyle( opacity: number ): CSSProperties {
	return { opacity, transform: `translateX(-50%) translateY(${ ( 1 - opacity ) * 3 }px)` };
}

function hoverStyle( opacity: number ): CSSProperties {
	return { backgroundColor: `rgba(255, 255, 255, ${ ( 0.09 * opacity ).toFixed( 3 ) })` };
}

function SettingsGlyph() {
	return (
		<svg className={ styles.btnGlyph } viewBox="0 0 24 24" aria-hidden="true">
			<path d="m19 7.5h-7.628c-.3089-.87389-1.1423-1.5-2.122-1.5-.97966 0-1.81309.62611-2.12197 1.5h-2.12803v1.5h2.12803c.30888.87389 1.14231 1.5 2.12197 1.5.9797 0 1.8131-.62611 2.122-1.5h7.628z" />
			<path d="m19 15h-2.128c-.3089-.8739-1.1423-1.5-2.122-1.5s-1.8131.6261-2.122 1.5h-7.628v1.5h7.628c.3089.8739 1.1423 1.5 2.122 1.5s1.8131-.6261 2.122-1.5h2.128z" />
		</svg>
	);
}

// Page 1 — the sidebar. A single site row plays out what the copy points at: a
// cursor drifts in, hovers the site-overview button (tooltip), moves to the
// status button and clicks it to start the site — stopped (play) → starting
// (amber) → running (green) — then leaves and the loop repeats.
export function SitesIllustration() {
	const colorScheme = useColorScheme();
	const chromeBg = colorScheme === 'dark' ? CHROME_BG_DARK : CHROME_BG_LIGHT;
	const { t } = useTimeline( { duration: LOOP, loop: true } );

	const cursor = sample( t, CURSOR_PATH );
	const dot = statusDot( t );
	const overviewTip = envelope( t, 770, 440, 2970, 440 );
	const stoppedTip = envelope( t, 3740, 440, 4840, 330 );
	const startingTip = envelope( t, 4840, 330, 6820, 330 );
	const runningTip = envelope( t, 6820, 330, 8580, 440 );

	return (
		<ThemeProvider color={ { bg: chromeBg } }>
			<div
				className={ styles.sitesScene }
				style={ { '--sites-chrome-bg': chromeBg } as CSSProperties }
				aria-hidden="true"
			>
				<div className={ styles.list }>
					<div className={ clsx( styles.rowGhost, styles.rowGhostFar ) }>
						<span className={ styles.rowGhostName }>Photography Portfolio</span>
					</div>
					<div className={ styles.rowGhost }>
						<span className={ styles.rowGhostName }>Marketing Site</span>
					</div>
					<div className={ styles.row }>
						<span className={ styles.rowName }>My WordPress Website</span>
						<div className={ styles.rowActions }>
							<div
								className={ styles.btn }
								style={ hoverStyle( envelope( t, 770, 440, 2970, 440 ) ) }
							>
								<SettingsGlyph />
								<Tooltip style={ tooltipStyle( overviewTip ) }>{ __( 'Site overview' ) }</Tooltip>
							</div>
							<div
								className={ styles.btn }
								style={ hoverStyle( envelope( t, 3740, 440, 8580, 440 ) ) }
							>
								<svg
									className={ styles.statusPlay }
									viewBox="0 0 10 10"
									aria-hidden="true"
									style={ { opacity: playOpacity( t ) } }
								>
									<path d="M2.5 1 L9 5 L2.5 9 Z" />
								</svg>
								<span
									className={ styles.statusDot }
									style={ { opacity: dot.opacity, backgroundColor: dot.color } }
								/>
								{ /* Three tooltips fade one into the next, reading as one box whose
								     wording changes as the site starts. */ }
								<Tooltip style={ tooltipStyle( stoppedTip ) }>
									{ __( 'Site status: Stopped' ) }
								</Tooltip>
								<Tooltip style={ tooltipStyle( startingTip ) }>{ __( 'Starting site…' ) }</Tooltip>
								<Tooltip style={ tooltipStyle( runningTip ) }>
									{ __( 'Site status: Running' ) }
								</Tooltip>
							</div>
						</div>
						<Cursor
							className={ styles.cursor }
							style={ {
								transform: `translate(${ cursor.x }px, ${ cursor.y }px) scale(${ cursor.scale })`,
								opacity: cursor.opacity,
							} }
						/>
					</div>
					<div className={ styles.rowGhost }>
						<span className={ styles.rowGhostName }>Recipe Blog</span>
					</div>
					<div className={ clsx( styles.rowGhost, styles.rowGhostFar ) }>
						<span className={ styles.rowGhostName }>Dev Sandbox</span>
					</div>
				</div>
			</div>
		</ThemeProvider>
	);
}
