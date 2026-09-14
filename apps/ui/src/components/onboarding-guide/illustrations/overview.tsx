import { __ } from '@wordpress/i18n';
import { databaseLogo, editorLogos } from '@/lib/logos';
import { easings, envelope, sample, useTimeline, type Keyframe } from './choreography';
import { Cursor } from './primitives';
import styles from './style.module.css';
import type { CSSProperties, ReactNode } from 'react';

const LOOP = 12000;

const CURSOR_PATH: Keyframe[] = [
	{ at: 0, x: 412, y: 188, scale: 1, opacity: 0, ease: easings.easeOut },
	{ at: 700, x: 412, y: 188, scale: 1, opacity: 0, ease: easings.easeInOut },
	{ at: 1800, x: 80, y: 37, scale: 1, opacity: 1, ease: easings.easeInOut },
	{ at: 2300, x: 80, y: 37, scale: 1, opacity: 1, ease: easings.easeInOut },
	{ at: 3400, x: 211, y: 19, scale: 1, opacity: 1, ease: easings.easeInOut },
	{ at: 3900, x: 211, y: 19, scale: 1, opacity: 1, ease: easings.easeInOut },
	{ at: 5000, x: 297, y: 99, scale: 1, opacity: 1, ease: easings.easeInOut },
	{ at: 5500, x: 297, y: 99, scale: 1, opacity: 1, ease: easings.easeInOut },
	{ at: 6600, x: 211, y: 120, scale: 1, opacity: 1, ease: easings.easeInOut },
	{ at: 7100, x: 211, y: 120, scale: 1, opacity: 1, ease: easings.easeInOut },
	{ at: 8200, x: 297, y: 158, scale: 1, opacity: 1, ease: easings.easeInOut },
	{ at: 8700, x: 297, y: 158, scale: 1, opacity: 1, ease: easings.easeOut },
	{ at: 8850, x: 297, y: 159, scale: 0.86, opacity: 1, ease: easings.easeOut },
	{ at: 9000, x: 297, y: 158, scale: 1, opacity: 1, ease: easings.easeInOut },
	{ at: 10400, x: 412, y: 188, scale: 1, opacity: 0, ease: easings.easeInOut },
	{ at: LOOP, x: 412, y: 188, scale: 1, opacity: 0 },
];

const CAMERA_PATH: Keyframe[] = [
	{ at: 0, x: 0, y: 0, scale: 0.64, opacity: 1, ease: easings.easeOut },
	{ at: 700, x: 0, y: 0, scale: 0.64, opacity: 1, ease: easings.easeInOut },
	{ at: 1800, x: 198, y: 86, scale: 1.5, opacity: 1, ease: easings.easeInOut },
	{ at: 2300, x: 198, y: 86, scale: 1.5, opacity: 1, ease: easings.easeInOut },
	{ at: 3400, x: 0, y: 113, scale: 1.5, opacity: 1, ease: easings.easeInOut },
	{ at: 3900, x: 0, y: 113, scale: 1.5, opacity: 1, ease: easings.easeInOut },
	{ at: 5000, x: -129, y: -8, scale: 1.5, opacity: 1, ease: easings.easeInOut },
	{ at: 5500, x: -129, y: -8, scale: 1.5, opacity: 1, ease: easings.easeInOut },
	{ at: 6600, x: 0, y: -39, scale: 1.5, opacity: 1, ease: easings.easeInOut },
	{ at: 7100, x: 0, y: -39, scale: 1.5, opacity: 1, ease: easings.easeInOut },
	{ at: 8200, x: -129, y: -96, scale: 1.5, opacity: 1, ease: easings.easeInOut },
	{ at: 9000, x: -129, y: -96, scale: 1.5, opacity: 1, ease: easings.easeInOut },
	{ at: 10400, x: 0, y: 0, scale: 0.64, opacity: 1, ease: easings.easeInOut },
	{ at: LOOP, x: 0, y: 0, scale: 0.64, opacity: 1 },
];

function actionStyle( opacity: number ): CSSProperties {
	return {
		backgroundColor: `color-mix(in srgb, var(--wpds-color-foreground-content-neutral) ${ Math.round(
			opacity * 9
		) }%, transparent)`,
		borderColor:
			opacity > 0.35
				? 'var(--wpds-color-stroke-interactive-neutral)'
				: 'var(--wpds-color-stroke-surface-neutral)',
	};
}

function WindowGlyph() {
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<path d="M2.5 3.5h11v8h-11zM1.5 13h13" />
		</svg>
	);
}

function StylesGlyph() {
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<circle cx="8" cy="8" r="5.5" />
			<path d="M8 2.5a5.5 5.5 0 0 0 0 11z" fill="currentColor" />
		</svg>
	);
}

function PageGlyph() {
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<rect x="3.5" y="2.5" width="9" height="11" rx="1" />
			<path d="M6 6h4M6 8.5h4M6 11h3" />
		</svg>
	);
}

function PatternGlyph() {
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<path d="M2.5 2.5h4v4h-4zM9.5 2.5h4v4h-4zM2.5 9.5h4v4h-4zM9.5 9.5h4v4h-4z" />
		</svg>
	);
}

function NavigationGlyph() {
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<path d="M3 4h10M3 8h7M3 12h10" />
		</svg>
	);
}

function TemplateGlyph() {
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<rect x="2.5" y="2.5" width="11" height="11" rx="1" />
			<path d="M2.5 6h11M7 6v7.5" />
		</svg>
	);
}

function MediaGlyph() {
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<rect x="2.5" y="3" width="11" height="10" rx="1" />
			<circle cx="5.5" cy="6" r="1" />
			<path d="m3.5 11 3-3 2 2 1.5-1.5 2.5 2.5" />
		</svg>
	);
}

function FinderGlyph() {
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<rect x="2.5" y="2.5" width="11" height="11" rx="2" />
			<path d="M8 2.5v11M5 6h.01M10.5 6h.01M5 10c1.5 1 4.5 1 6 0" />
		</svg>
	);
}

function TerminalGlyph() {
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<rect x="2.5" y="3" width="11" height="10" rx="1" />
			<path d="m5 6 2 2-2 2M8.5 10h2.5" />
		</svg>
	);
}

function DuplicateGlyph() {
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<rect x="4.5" y="4.5" width="9" height="9" rx="1" />
			<path d="M11.5 4.5v-2h-9v9h2" />
		</svg>
	);
}

function ExportGlyph() {
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<path d="M8 2.5v8M5 7.5l3 3 3-3M3 12v1.5h10V12" />
		</svg>
	);
}

function DeleteGlyph() {
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<path d="M3 4.5h10M6 2.5h4M4.5 4.5l.7 9h5.6l.7-9M7 7v4M9 7v4" />
		</svg>
	);
}

function OverviewAction( {
	icon,
	label,
	hover,
	iconStyle,
}: {
	icon: ReactNode;
	label: string;
	hover?: number;
	iconStyle?: 'brand' | 'database';
} ) {
	return (
		<div className={ styles.overviewAction } style={ actionStyle( hover ?? 0 ) }>
			<span className={ styles.overviewActionIcon } data-icon-style={ iconStyle }>
				{ icon }
			</span>
			<span>{ label }</span>
		</div>
	);
}

export function OverviewIllustration() {
	const { t } = useTimeline( { duration: LOOP, loop: true } );
	const cursor = sample( t, CURSOR_PATH );
	const camera = sample( t, CAMERA_PATH );
	const aboutHover = envelope( t, 1500, 250, 2400, 250 );
	const editorHover = envelope( t, 3100, 250, 4000, 250 );
	const cursorHover = envelope( t, 4700, 250, 5600, 250 );
	const databaseHover = envelope( t, 6300, 250, 7200, 250 );
	const exportHover = envelope( t, 7900, 250, 9100, 250 );

	return (
		<div className={ styles.overviewScene } aria-hidden="true">
			<div
				className={ styles.overviewPanel }
				style={ {
					transform: `translate(${ camera.x }px, ${ camera.y }px) scale(${ camera.scale })`,
				} }
			>
				<div className={ styles.overviewContent }>
					<section className={ styles.overviewAbout }>
						<h3>{ __( 'About' ) }</h3>
						<div className={ styles.overviewAboutCard } style={ actionStyle( aboutHover ) }>
							<div className={ styles.overviewThemeSummary }>
								<div className={ styles.overviewThumbnail }>
									<span className={ styles.overviewThumbnailTitle } />
									<span className={ styles.overviewThumbnailCopy } />
									<span className={ styles.overviewThumbnailButton } />
								</div>
								<div className={ styles.overviewThemeDetails }>
									<span>{ __( 'Theme' ) }</span>
									<strong>{ __( 'My Happy Website (Dark Mode)' ) }</strong>
									<small>WP v7.0.3 · PHP v8.4</small>
								</div>
							</div>
							<div className={ styles.overviewStorage }>
								<div className={ styles.overviewStorageHeading }>
									<span>{ __( 'Disk' ) }</span>
									<strong>84 MB</strong>
								</div>
								<div className={ styles.overviewStorageBar }>
									<span data-storage="plugins" />
									<span data-storage="themes" />
									<span data-storage="database" />
									<span data-storage="other" />
								</div>
							</div>
						</div>
					</section>
					<div className={ styles.overviewActions }>
						<section>
							<h3>{ __( 'Customize' ) }</h3>
							<div className={ styles.overviewGrid }>
								<OverviewAction
									icon={ <WindowGlyph /> }
									label={ __( 'Site Editor' ) }
									hover={ editorHover }
								/>
								<OverviewAction icon={ <StylesGlyph /> } label={ __( 'Styles' ) } />
								<OverviewAction icon={ <PatternGlyph /> } label={ __( 'Patterns' ) } />
								<OverviewAction icon={ <NavigationGlyph /> } label={ __( 'Navigation' ) } />
								<OverviewAction icon={ <TemplateGlyph /> } label={ __( 'Templates' ) } />
								<OverviewAction icon={ <PageGlyph /> } label={ __( 'Pages' ) } />
								<OverviewAction icon={ <MediaGlyph /> } label={ __( 'Media Library' ) } />
							</div>
						</section>
						<section>
							<h3>{ __( 'Open in…' ) }</h3>
							<div className={ styles.overviewGrid }>
								<OverviewAction icon={ <FinderGlyph /> } label={ __( 'Finder' ) } />
								<OverviewAction
									icon={ editorLogos.cursor }
									iconStyle="brand"
									label="Cursor"
									hover={ cursorHover }
								/>
								<OverviewAction icon={ <TerminalGlyph /> } label={ __( 'Terminal' ) } />
								<OverviewAction
									icon={ databaseLogo }
									iconStyle="database"
									label={ __( 'phpMyAdmin' ) }
									hover={ databaseHover }
								/>
							</div>
						</section>
						<section>
							<h3>{ __( 'Manage' ) }</h3>
							<div className={ styles.overviewGrid }>
								<OverviewAction icon={ <DuplicateGlyph /> } label={ __( 'Duplicate' ) } />
								<OverviewAction
									icon={ <ExportGlyph /> }
									label={ __( 'Export entire site' ) }
									hover={ exportHover }
								/>
								<OverviewAction
									icon={ databaseLogo }
									iconStyle="database"
									label={ __( 'Export database' ) }
								/>
								<OverviewAction icon={ <DeleteGlyph /> } label={ __( 'Delete' ) } />
							</div>
						</section>
					</div>
				</div>
				<Cursor
					className={ styles.overviewCursor }
					style={ {
						transform: `translate(${ cursor.x }px, ${ cursor.y }px) scale(${ cursor.scale })`,
						opacity: cursor.opacity,
					} }
				/>
			</div>
		</div>
	);
}
