import { __ } from '@wordpress/i18n';
import { brush, check, chevronDown, close, file, plugins } from '@wordpress/icons';
import { privateApis } from '@wordpress/theme';
import { Icon } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { unlock } from '@/lock-unlock';
import {
	at,
	easings,
	envelope,
	sample,
	span,
	useTimeline,
	type Keyframe,
	type Playback,
} from './choreography';
import { Cursor } from './primitives';
import styles from './style.module.css';
import type { CSSProperties } from 'react';

const { ThemeProvider } = unlock( privateApis );

// Same chrome as the sidebar scene: dark in both schemes.
const CHROME_BG_LIGHT = '#1e1e1e';
const CHROME_BG_DARK = '#161616';
const VIEW = { w: 460, h: 345 };
const CLICK = { down: 90, up: 160 };
// World layout: the sidebar on the left, the push dialog over the app surface
// on the right. Fixed sizes so the cursor and camera can aim.
// Wider than the camera's view at the sidebar zoom, so no app surface peeks in.
const SIDEBAR_WIDTH = 300;
const MAIN_WIDTH = 690;
const DIALOG = { x: SIDEBAR_WIDTH + ( MAIN_WIDTH - 550 ) / 2, y: 20, w: 550, h: 502 };
const PUSH_BUTTON = { x: DIALOG.x + DIALOG.w - 32 - 30, y: DIALOG.y + DIALOG.h - 32 - 18 };
const SYNC_ROW = { x: SIDEBAR_WIDTH / 2, y: 143 };
const TOAST_SHELF = { x: SIDEBAR_WIDTH / 2, y: 562 };
const DIALOG_ZOOM = 0.6;
// The tree's rows, dialog-relative: checkbox centers for the cursor.
const TREE_ROWS = {
	plugin1: { x: 113, y: 199 },
	plugin2: { x: 113, y: 235 },
	theme1: { x: 113, y: 307 },
};
// Framing the plugin and theme rows while they're being checked.
const TREE_FOCUS = { x: DIALOG.x + 226, y: DIALOG.y + 253, zoom: 1.15 };

type CheckState = 'off' | 'on' | 'mixed';

function Checkbox( { state }: { state: CheckState } ) {
	return (
		<span
			className={ clsx(
				styles.pushCheckbox,
				state === 'on' && styles.pushCheckboxOn,
				state === 'mixed' && styles.pushCheckboxMixed
			) }
		/>
	);
}

// Signed-out sign-in prompt — sync. Opens on the real push dialog; Push
// confirms it, then the camera pulls over to the sidebar, where the site row
// shows its syncing mark until the push lands and the "Push complete" toast
// arrives in the sidebar's shelf. One-shot.
export function SigninSyncIllustration( { playback }: { playback?: Playback } ) {
	const chromeBg = useColorScheme() === 'dark' ? CHROME_BG_DARK : CHROME_BG_LIGHT;

	const checkAt = [ 2300, 3000, 3800 ];
	const pushAt = 5300;
	const syncAt = pushAt + 250;
	const doneAt = syncAt + 6000;
	const toastAt = doneAt + 300;
	const endAt = toastAt + 3200;

	const at1 = { x: DIALOG.x + TREE_ROWS.plugin1.x, y: DIALOG.y + TREE_ROWS.plugin1.y };
	const at2 = { x: DIALOG.x + TREE_ROWS.plugin2.x, y: DIALOG.y + TREE_ROWS.plugin2.y };
	const at3 = { x: DIALOG.x + TREE_ROWS.theme1.x, y: DIALOG.y + TREE_ROWS.theme1.y };
	const path: Keyframe[] = [
		{ at: 0, x: 620, y: 470, scale: 1, opacity: 0, ease: easings.easeOut },
		{ at: 1400, x: 620, y: 470, scale: 1, opacity: 1, ease: easings.easeInOut },
		{ at: checkAt[ 0 ] - 100, ...at1, scale: 1, opacity: 1, ease: easings.easeOut },
		{ at: checkAt[ 0 ], ...at1, scale: 0.86, opacity: 1, ease: easings.easeOut },
		{ at: checkAt[ 0 ] + CLICK.up, ...at1, scale: 1, opacity: 1, ease: easings.easeInOut },
		{ at: checkAt[ 1 ] - 100, ...at2, scale: 1, opacity: 1, ease: easings.easeOut },
		{ at: checkAt[ 1 ], ...at2, scale: 0.86, opacity: 1, ease: easings.easeOut },
		{ at: checkAt[ 1 ] + CLICK.up, ...at2, scale: 1, opacity: 1, ease: easings.easeInOut },
		{ at: checkAt[ 2 ] - 100, ...at3, scale: 1, opacity: 1, ease: easings.easeOut },
		{ at: checkAt[ 2 ], ...at3, scale: 0.86, opacity: 1, ease: easings.easeOut },
		{ at: checkAt[ 2 ] + CLICK.up, ...at3, scale: 1, opacity: 1, ease: easings.easeInOut },
		{ at: pushAt - 100, ...PUSH_BUTTON, scale: 1, opacity: 1, ease: easings.easeOut },
		{ at: pushAt, ...PUSH_BUTTON, scale: 0.86, opacity: 1, ease: easings.easeOut },
		{ at: pushAt + CLICK.up, ...PUSH_BUTTON, scale: 1, opacity: 1, ease: easings.easeInOut },
		{ at: pushAt + 900, x: 900, y: 620, scale: 1, opacity: 0 },
	];
	const dialogCenter = { x: DIALOG.x + DIALOG.w / 2, y: DIALOG.y + DIALOG.h / 2 };
	const cameraPath: Keyframe[] = [
		{ at: 0, ...dialogCenter, zoom: DIALOG_ZOOM, ease: easings.easeInOut },
		{ at: 1200, ...dialogCenter, zoom: DIALOG_ZOOM, ease: easings.easeInOut },
		{ at: 1900, ...TREE_FOCUS, ease: easings.easeInOut },
		{ at: checkAt[ 2 ] + 500, ...TREE_FOCUS, ease: easings.easeInOut },
		{ at: pushAt - 300, ...dialogCenter, zoom: DIALOG_ZOOM, ease: easings.easeInOut },
		{ at: pushAt + 500, ...dialogCenter, zoom: DIALOG_ZOOM, ease: easings.easeInOut },
		{ at: pushAt + 1300, ...SYNC_ROW, zoom: 1.6, ease: easings.easeInOut },
		{ at: doneAt + 200, ...SYNC_ROW, zoom: 1.6, ease: easings.easeInOut },
		{ at: doneAt + 1100, ...TOAST_SHELF, zoom: 1.6 },
	];

	const { t } = useTimeline( { duration: endAt, loop: false, playback } );

	const pointer = sample( t, path );
	const camera = sample( t, cameraPath );
	const pressP = envelope( t, pushAt, CLICK.down, pushAt + CLICK.down, CLICK.up );
	const checked = checkAt.map( ( cue ) => at( t, cue ) );
	const pluginsState: CheckState =
		checked[ 0 ] && checked[ 1 ] ? 'on' : checked[ 0 ] || checked[ 1 ] ? 'mixed' : 'off';
	const themesState: CheckState = checked[ 2 ] ? 'mixed' : 'off';
	const anyChecked = checked.some( Boolean );
	const branchState: CheckState = anyChecked ? 'mixed' : 'off';
	// The modal slides off to the right; the sidebar slides in from the left as
	// the camera heads over to it.
	const dialogSlide = span( t, pushAt + 250, pushAt + 850, easings.easeIn ) * 760;
	const dialogGone = at( t, pushAt + 850 );
	const sidebarSlide = ( 1 - span( t, pushAt + 500, pushAt + 1300, easings.easeOut ) ) * -320;
	const dotsOp =
		span( t, syncAt, syncAt + 250, easings.easeOut ) -
		span( t, doneAt, doneAt + 250, easings.easeIn );
	const toastP = span( t, toastAt, toastAt + 220, easings.easeOut );

	return (
		<div className={ clsx( styles.chatScene, styles.chatSceneBare ) }>
			<div
				className={ styles.syncWorld }
				style={ {
					transform: `translate(${ VIEW.w / 2 }px, ${ VIEW.h / 2 }px) scale(${
						camera.zoom
					}) translate(${ -camera.x }px, ${ -camera.y }px)`,
				} }
			>
				<ThemeProvider color={ { background: chromeBg } }>
					<div
						className={ styles.syncSidebar }
						style={
							{
								'--sites-chrome-bg': chromeBg,
								transform: `translateX(${ sidebarSlide }px)`,
							} as CSSProperties
						}
					>
						<div className={ styles.syncSites }>
							{ [ 'Photography Portfolio', 'Marketing Site' ].map( ( name ) => (
								<div key={ name } className={ styles.syncSiteRow }>
									<span className={ styles.syncActivitySlot } />
									<span className={ styles.syncSiteName }>{ name }</span>
								</div>
							) ) }
							<div className={ clsx( styles.syncSiteRow, styles.syncSiteRowActive ) }>
								<span className={ styles.syncActivitySlot }>
									{ dotsOp > 0 ? (
										<span className={ styles.syncDots } style={ { opacity: dotsOp } }>
											<span className={ styles.syncDot } />
											<span className={ styles.syncDot } />
											<span className={ styles.syncDot } />
										</span>
									) : null }
								</span>
								<span className={ clsx( styles.syncSiteName, styles.syncSiteNameActive ) }>
									My WordPress Website
								</span>
								<span className={ styles.syncStatusButton }>
									<span className={ styles.syncStatusGlyph } />
								</span>
							</div>
							{ [ 'Recipe Blog', 'Dev Sandbox' ].map( ( name ) => (
								<div key={ name } className={ styles.syncSiteRow }>
									<span className={ styles.syncActivitySlot } />
									<span className={ styles.syncSiteName }>{ name }</span>
								</div>
							) ) }
						</div>
						<div className={ styles.syncFooter }>
							{ toastP > 0 ? (
								<div
									className={ styles.syncToast }
									style={ {
										opacity: toastP,
										transform: `translateY(${ ( 1 - toastP ) * 6 }px)`,
									} }
								>
									<span className={ styles.syncToastIcon }>
										<Icon icon={ check } size={ 16 } />
									</span>
									<span className={ styles.syncToastText }>
										<span className={ styles.syncToastTitle }>{ __( 'Push complete' ) }</span>
										<span className={ styles.syncToastDescription }>
											{ __( 'My WordPress Website is live on my-wordpress-website.com.' ) }
										</span>
									</span>
									<span className={ styles.syncToastClose }>
										<Icon icon={ close } size={ 16 } />
									</span>
								</div>
							) : null }
						</div>
					</div>
				</ThemeProvider>

				<div className={ styles.syncMain }>
					{ ! dialogGone ? (
						<div
							className={ styles.pushDialog }
							style={ { transform: `translateX(${ dialogSlide }px)` } }
						>
							<div className={ styles.pushDialogSelectorRow }>
								<span className={ styles.pushDialogHeading }>
									{ __( 'What would you like to push?' ) }
								</span>
								<span className={ styles.pushDialogSelect }>
									{ __( 'Specific files and folders' ) }
									<Icon icon={ chevronDown } size={ 18 } />
								</span>
							</div>
							<div className={ styles.pushTree }>
								<span className={ clsx( styles.pushTreeRow, styles.pushTreeRowTop ) }>
									<Checkbox state={ branchState } />
									{ __( 'Files and folders' ) }
								</span>
								<span className={ styles.pushTreeNested }>
									<span className={ styles.pushTreeRow }>
										<Checkbox state={ branchState } />
										<Icon className={ styles.pushTreeFolder } icon={ file } size={ 20 } />
										wp-content
										<Icon className={ styles.pushTreeExpand } icon={ chevronDown } size={ 16 } />
									</span>
									<span className={ clsx( styles.pushTreeRow, styles.pushTreeIndent1 ) }>
										<Checkbox state={ pluginsState } />
										<Icon className={ styles.pushTreeFolder } icon={ file } size={ 20 } />
										plugins
										<Icon className={ styles.pushTreeExpand } icon={ chevronDown } size={ 16 } />
									</span>
									<span className={ clsx( styles.pushTreeRow, styles.pushTreeIndent2 ) }>
										<Checkbox state={ checked[ 0 ] ? 'on' : 'off' } />
										<Icon className={ styles.pushTreeFolder } icon={ plugins } size={ 20 } />
										contact-form-7
									</span>
									<span className={ clsx( styles.pushTreeRow, styles.pushTreeIndent2 ) }>
										<Checkbox state={ checked[ 1 ] ? 'on' : 'off' } />
										<Icon className={ styles.pushTreeFolder } icon={ plugins } size={ 20 } />
										jetpack
									</span>
									<span className={ clsx( styles.pushTreeRow, styles.pushTreeIndent1 ) }>
										<Checkbox state={ themesState } />
										<Icon className={ styles.pushTreeFolder } icon={ file } size={ 20 } />
										themes
										<Icon className={ styles.pushTreeExpand } icon={ chevronDown } size={ 16 } />
									</span>
									<span className={ clsx( styles.pushTreeRow, styles.pushTreeIndent2 ) }>
										<Checkbox state={ checked[ 2 ] ? 'on' : 'off' } />
										<Icon className={ styles.pushTreeFolder } icon={ brush } size={ 20 } />
										twentytwentyfive
									</span>
									<span className={ clsx( styles.pushTreeRow, styles.pushTreeIndent2 ) }>
										<Checkbox state="off" />
										<Icon className={ styles.pushTreeFolder } icon={ brush } size={ 20 } />
										studio-blog
									</span>
								</span>
								<span className={ clsx( styles.pushTreeRow, styles.pushTreeRowTop ) }>
									<Checkbox state="off" />
									{ __( 'Database' ) }
								</span>
							</div>
							<div className={ styles.pushDialogFooter }>
								<span className={ styles.pushDialogActions }>
									<span className={ styles.pushDialogCancel }>{ __( 'Cancel' ) }</span>
									<span
										className={ clsx(
											styles.pushDialogPush,
											! anyChecked && styles.pushDialogPushDisabled,
											pressP > 0 && styles.pushDialogPushPressed
										) }
									>
										{ __( 'Push' ) }
									</span>
								</span>
							</div>
						</div>
					) : null }
				</div>

				<Cursor
					className={ styles.sceneCursor }
					style={ {
						opacity: pointer.opacity,
						transform: `translate(${ pointer.x }px, ${ pointer.y }px) scale(${
							pointer.scale / camera.zoom
						})`,
					} }
				/>
			</div>
		</div>
	);
}
