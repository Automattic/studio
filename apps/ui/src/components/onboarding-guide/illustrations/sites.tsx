import { __ } from '@wordpress/i18n';
import { privateApis } from '@wordpress/theme';
import { clsx } from 'clsx';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { unlock } from '@/lock-unlock';
import { Cursor } from './stage';
import styles from './style.module.css';
import type { CSSProperties } from 'react';

const { ThemeProvider } = unlock( privateApis );

// The sidebar sits on the dark window chrome in both color schemes, so this
// scene mirrors the sidebar-layout: a dark chrome background and a nested dark
// theme scope so the row's wpds tokens resolve against the dark ramp.
const CHROME_BG_LIGHT = '#1e1e1e';
const CHROME_BG_DARK = '#161616';

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
							<div className={ clsx( styles.btn, styles.btnOverview ) }>
								<SettingsGlyph />
								<span className={ clsx( styles.tooltip, styles.tooltipOverview ) }>
									{ __( 'Site overview' ) }
								</span>
							</div>
							<div className={ clsx( styles.btn, styles.btnStatus ) }>
								<svg className={ styles.statusPlay } viewBox="0 0 10 10" aria-hidden="true">
									<path d="M2.5 1 L9 5 L2.5 9 Z" />
								</svg>
								<span className={ styles.statusDot } />
								{ /* Three right-anchored tooltips fade one into the next, reading as
								     one box whose wording changes as the site starts. */ }
								<span className={ clsx( styles.tooltip, styles.tipStart ) }>
									{ __( 'Site status: Stopped' ) }
								</span>
								<span className={ clsx( styles.tooltip, styles.tipStarting ) }>
									{ __( 'Starting site…' ) }
								</span>
								<span className={ clsx( styles.tooltip, styles.tipRunning ) }>
									{ __( 'Site status: Running' ) }
								</span>
							</div>
						</div>
						<Cursor className={ styles.cursor } />
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
