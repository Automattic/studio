import { __ } from '@wordpress/i18n';
import { wordpress, globe, pencil } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { clsx } from 'clsx';
import { databaseIcon } from '@/lib/icons';
import { easings, sample, span, useTimeline, type Keyframe } from './choreography';
import { Cursor } from './primitives';
import styles from './style.module.css';
import type { ReactElement, SVGProps } from 'react';

const LOOP = 14500;
const COMMENT = 'Make this button blue';

const CURSOR_PATH: Keyframe[] = [
	{ at: 0, x: 260, y: 80, scale: 1, opacity: 0, ease: easings.easeOut },
	{ at: 1000, x: 260, y: 80, scale: 1, opacity: 0, ease: easings.easeInOut },
	{ at: 1800, x: 58, y: 0, scale: 1, opacity: 1, ease: easings.easeInOut },
	{ at: 2200, x: 58, y: 0, scale: 1, opacity: 1, ease: easings.easeOut },
	{ at: 2350, x: 58, y: 1, scale: 0.86, opacity: 1, ease: easings.easeOut },
	{ at: 2500, x: 58, y: 0, scale: 1, opacity: 1, ease: easings.easeInOut },
	{ at: 3500, x: 73, y: 0, scale: 1, opacity: 1, ease: easings.easeInOut },
	{ at: 3900, x: 73, y: 0, scale: 1, opacity: 1, ease: easings.easeOut },
	{ at: 4050, x: 73, y: 1, scale: 0.86, opacity: 1, ease: easings.easeOut },
	{ at: 4200, x: 73, y: 0, scale: 1, opacity: 1, ease: easings.easeInOut },
	{ at: 5000, x: 73, y: 0, scale: 1, opacity: 1, ease: easings.easeInOut },
	{ at: 6700, x: 0, y: 0, scale: 1, opacity: 1, ease: easings.easeInOut },
	{ at: 8050, x: 0, y: 0, scale: 1, opacity: 1, ease: easings.easeOut },
	{ at: 8200, x: 0, y: 1, scale: 0.86, opacity: 1, ease: easings.easeOut },
	{ at: 8350, x: 0, y: 0, scale: 1, opacity: 1, ease: easings.easeInOut },
	{ at: 8900, x: 0, y: 22, scale: 1, opacity: 1, ease: easings.easeOut },
	{ at: 9050, x: 0, y: 23, scale: 0.86, opacity: 1, ease: easings.easeOut },
	{ at: 9200, x: 0, y: 22, scale: 1, opacity: 1, ease: easings.easeInOut },
	{ at: 11100, x: 168, y: 62, scale: 1, opacity: 1, ease: easings.easeOut },
	{ at: 11250, x: 168, y: 62, scale: 1, opacity: 1, ease: easings.easeOut },
	{ at: 11400, x: 168, y: 63, scale: 0.86, opacity: 1, ease: easings.easeOut },
	{ at: 11550, x: 168, y: 62, scale: 1, opacity: 1, ease: easings.easeInOut },
	{ at: 12700, x: 260, y: 100, scale: 1, opacity: 0, ease: easings.easeInOut },
	{ at: LOOP, x: 260, y: 100, scale: 1, opacity: 0 },
];

type Realm = 'frontend' | 'admin' | 'database';

const INDICATOR: Record< Realm, { x: number; width: number } > = {
	frontend: { x: 2, width: 150 },
	admin: { x: 38, width: 108 },
	database: { x: 74, width: 104 },
};

type RealmIcon = ReactElement< SVGProps< SVGSVGElement > >;

function RealmTab( {
	realm,
	activeRealm,
	icon,
	title,
}: {
	realm: Realm;
	activeRealm: Realm;
	icon: RealmIcon;
	title: string;
} ) {
	const active = realm === activeRealm;
	return (
		<div
			className={ clsx( styles.previewTab, active && styles.previewTabActive ) }
			data-realm={ realm }
		>
			<span className={ styles.previewTabIcon }>
				<Icon icon={ icon } size={ 16 } />
			</span>
			<span className={ styles.previewTabTitle }>{ title }</span>
		</div>
	);
}

export function PreviewIllustration() {
	const { t, restart } = useTimeline( { duration: LOOP, loop: false } );
	const cursor = sample( t, CURSOR_PATH );
	const activeRealm: Realm = t < 2400 ? 'frontend' : t < 4100 ? 'admin' : 'database';
	const indicator = INDICATOR[ activeRealm ];
	const tabsOffset = -600 * span( t, 5200, 6400 );
	const annotateOpacity = span( t, 5700, 6500 ) * ( 1 - span( t, 8250, 8700, easings.easeInOut ) );
	const tooltipVisible = t >= 6600 && t < 8050;
	const picking = t >= 8250 && t < 9200;
	const composerVisible = t >= 9200 && t < 11600;
	const skeletonProgress = span( t, 8300, 8800, easings.easeOut );
	const skeletonShift =
		-82 *
		span( t, 9200, 9500, easings.easeInOut ) *
		( 1 - span( t, 11600, 12000, easings.easeInOut ) );
	const commentProgress = span( t, 9200, 9500, easings.easeOut );
	const markerOneProgress = span( t, 12000, 12200, easings.easeOut );
	const markerTwoProgress = span( t, 12400, 12600, easings.easeOut );
	const markerThreeProgress = span( t, 12800, 13000, easings.easeOut );
	const replayOpacity = span( t, 13600, 13900, easings.easeOut );
	const commentLength = Math.floor( span( t, 9600, 10600, easings.linear ) * COMMENT.length );

	return (
		<div className={ styles.previewTabsScene }>
			<button
				type="button"
				className={ styles.replayButton }
				style={ {
					opacity: replayOpacity,
					pointerEvents: replayOpacity > 0.5 ? 'auto' : 'none',
				} }
				onClick={ restart }
			>
				{ __( 'Replay' ) }
			</button>
			<div className={ styles.previewSequence } aria-hidden="true">
				<div
					className={ styles.previewToolbar }
					style={ { transform: `translate(-50%, -50%) translateX(${ tabsOffset }px)` } }
				>
					<div className={ styles.previewTabs }>
						<span
							className={ styles.previewTabsIndicator }
							style={ {
								transform: `translateX(${ indicator.x }px)`,
								width: indicator.width,
							} }
						/>
						<RealmTab
							realm="frontend"
							activeRealm={ activeRealm }
							icon={ globe }
							title="My Happy Website"
						/>
						<RealmTab
							realm="admin"
							activeRealm={ activeRealm }
							icon={ wordpress }
							title="WordPress"
						/>
						<RealmTab
							realm="database"
							activeRealm={ activeRealm }
							icon={ databaseIcon }
							title="Database"
						/>
					</div>
				</div>
				<div className={ styles.previewAnnotateControl } style={ { opacity: annotateOpacity } }>
					{ tooltipVisible ? (
						<div className={ styles.previewAnnotateTooltip }>Annotate</div>
					) : null }
					<div
						className={ clsx(
							styles.previewAnnotateButton,
							picking && styles.previewAnnotateButtonActive
						) }
					>
						<Icon icon={ pencil } size={ 16 } />
					</div>
				</div>

				{ skeletonProgress > 0 ? (
					<div
						className={ styles.previewSkeletonPage }
						style={ {
							opacity: skeletonProgress,
							transform: `translateX(calc(-50% + ${ skeletonShift }px)) scale(${
								0.92 + skeletonProgress * 0.08
							})`,
						} }
					>
						<div className={ styles.previewSkeletonTitle } />
						<div className={ styles.previewSkeletonCopy } />
						<div
							className={ clsx(
								styles.previewSkeletonCta,
								( picking || composerVisible ) && styles.previewSkeletonCtaPicking
							) }
						/>
						{ markerOneProgress > 0 ? (
							<div
								className={ clsx(
									styles.previewAnnotationMarker,
									styles.previewAnnotationMarkerOne
								) }
								style={ {
									opacity: markerOneProgress,
									transform: `translate(-50%, -50%) scale(${ markerOneProgress })`,
								} }
							>
								1
							</div>
						) : null }
						{ markerTwoProgress > 0 ? (
							<div
								className={ clsx(
									styles.previewAnnotationMarker,
									styles.previewAnnotationMarkerTwo
								) }
								style={ {
									opacity: markerTwoProgress,
									transform: `translate(-50%, -50%) scale(${ markerTwoProgress })`,
								} }
							>
								2
							</div>
						) : null }
						{ markerThreeProgress > 0 ? (
							<div
								className={ clsx(
									styles.previewAnnotationMarker,
									styles.previewAnnotationMarkerThree
								) }
								style={ {
									opacity: markerThreeProgress,
									transform: `translate(-50%, -50%) scale(${ markerThreeProgress })`,
								} }
							>
								3
							</div>
						) : null }
					</div>
				) : null }
				{ composerVisible ? (
					<div
						className={ styles.previewCommentComposer }
						style={ {
							opacity: commentProgress,
							transform: `scale(${ 0.62 + commentProgress * 0.1 })`,
						} }
					>
						<div className={ styles.previewCommentTarget }>button — Call to action</div>
						<div className={ styles.previewCommentTextarea }>
							{ COMMENT.slice( 0, commentLength ) }
							<span className={ styles.previewCommentCaret } />
						</div>
						<div className={ styles.previewCommentActions }>
							<div className={ styles.previewCommentCancel }>Cancel</div>
							<div className={ styles.previewCommentSave }>Save</div>
						</div>
					</div>
				) : null }
				<Cursor
					className={ styles.previewTabsCursor }
					style={ {
						transform: `translate(${ cursor.x }px, ${ cursor.y }px) scale(${ cursor.scale })`,
						opacity: cursor.opacity,
					} }
				/>
			</div>
		</div>
	);
}
