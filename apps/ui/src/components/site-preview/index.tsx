import { useQuery } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import {
	capturePhoto,
	chevronLeft,
	chevronRight,
	closeSmall,
	code,
	copy,
	crop,
	external,
	file as fileIcon,
	moreVertical,
	pencil,
	search,
	trash,
} from '@wordpress/icons';
import { ariaKeyShortcut, displayShortcut, isAppleOS, isKeyboardEvent } from '@wordpress/keycodes';
import { Button, Icon, IconButton, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DotGrid } from '@/components/dot-grid';
import * as Menu from '@/components/menu';
import { OpenInDestinationItems, OpenInMenu } from '@/components/open-in-menu';
import { ResizeHandle, ResizeOverlay } from '@/components/resize-handle';
import {
	QuickMenuItem,
	QuickMenuPopup,
	QuickMenuSubmenuTrigger,
	QuickMenuTrigger,
} from '@/components/site-quick-menu';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useIsSiteStarting, useStartSite } from '@/data/queries/use-sites';
import { usePointerDrag } from '@/hooks/use-pointer-drag';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { useTrafficLightSpace } from '@/hooks/use-traffic-light-space';
import { useWindowControlsOverlay } from '@/hooks/use-window-controls-overlay';
import { getSiteUrl } from '@/lib/get-site-url';
import { playIcon, refreshIcon } from '@/lib/icons';
import { usePluginSiteTag } from '@/lib/plugin-prototype';
import {
	formatPreviewConsoleEntriesForText,
	getPreviewConsoleSourceLabel,
	MAX_PREVIEW_CONSOLE_ENTRIES,
} from './console-utils';
import {
	DATABASE_HOME_PATH,
	getPathFromPreviewUrl,
	getPreviewRealm,
	getRealmNavigationPath,
	PreviewAddressBar,
	REALM_SHORTCUT_KEYS,
	type PreviewRealm,
} from './location-omnibox';
import styles from './style.module.css';
import {
	areBrowserStatesEqual,
	EMPTY_BROWSER_STATE,
	EMPTY_INSPECTOR_STATE,
	WebviewSurface,
	type BrowserCommand,
	type BrowserNavigationState,
	type BrowserShortcutCommandType,
	type InspectorCommandRequest,
	type InspectorState,
	type PageClipRequest,
	type PreviewColorScheme,
	type PreviewViewport,
} from './webview-surface';
import type {
	PreviewConsoleEntry,
	PreviewConsoleLevel,
	PreviewConsoleTextFile,
	RawClipCapture,
} from './types';
import type { SiteDetails } from '@/data/core';
import type { ComposerClipInput } from '@studio/common/ai/composer-attachments';
import type {
	ClipMarker,
	InspectorHostCommand,
	InspectorMode,
} from '@studio/common/inspector/protocol';
import type {
	CSSProperties,
	ComponentProps,
	KeyboardEvent as ReactKeyboardEvent,
	ReactElement,
} from 'react';

export type { PreviewConsoleEntry, PreviewConsoleTextFile, RawClipCapture } from './types';
export type { PreviewViewport } from './webview-surface';
export { getPathFromPreviewUrl } from './location-omnibox';

interface SitePreviewProps {
	site: SiteDetails;
	// Path to display within the previewed site, controlled by the parent so
	// it can be updated by chat artifact events even when the panel was
	// previously collapsed.
	path: string;
	// Bumped by the parent to force a webview reload.
	reloadNonce: number;
	// Called for every finished clip (element, region, page, console): the
	// session view turns it into a composer attachment. The clip UI only
	// renders when provided.
	onClip?: ( input: ComposerClipInput ) => void | Promise< void >;
	// Marker-popup edits to existing clips (the composer owns them).
	onClipUpdate?: ( id: string, comment: string ) => void;
	onClipRemove?: ( id: string ) => void;
	// "Add selected text to chat": quoted text for the composer draft.
	onComposerText?: ( text: string ) => void;
	// The active session's clips, mirrored into the guest page as numbered
	// markers (and used for chip↔marker identity).
	clipMarkers?: ClipMarker[];
	// Called when the user navigates within the preview (link clicks,
	// back/forward) so the parent can keep its `path` in sync without
	// forcing a reload.
	onPathChange?: ( path: string ) => void;
	// True while the panel is toggled off but kept mounted (so the webview
	// stays warm). Disables the global browser shortcuts in that state.
	collapsed?: boolean;
	// True while the preview fills the whole window (sidebar and chat hidden).
	// Reflected on the toolbar's full-preview toggle button.
	fullscreen?: boolean;
	// Called when the user toggles full preview from the toolbar. The button
	// only renders when provided.
	onToggleFullscreen?: () => void;
	// Mirrors the preview's bounded console buffer to dashboard/session state so
	// agent turns can include recent browser console output.
	onConsoleEntriesChange?: ( entries: PreviewConsoleEntry[] ) => void;
}

type ConsoleFilter = 'all' | PreviewConsoleLevel;

interface ViewportPreset {
	id: 'mobile' | 'tablet' | 'desktop';
	width: number;
	// A fixed device height: the preset renders as a phone-proportioned
	// frame instead of extending to the pane's height.
	height?: number;
	// Report the emulated viewport to the page as a mobile device.
	mobile?: boolean;
}

// Simulated-viewport presets, pending a designed control: the WordPress
// editor's desktop/tablet/mobile trio. Mobile pins an iPhone-class width AND
// height; the wider presets simulate width only.
const VIEWPORT_PRESETS: readonly ViewportPreset[] = [
	{ id: 'mobile', width: 390, height: 844, mobile: true },
	{ id: 'tablet', width: 768 },
	{ id: 'desktop', width: 1440 },
];

// The preview's viewport mode: natural pane size, one simulated preset, or
// the side-by-side comparison of the desktop and mobile presets.
type ViewportMode = 'fit' | ViewportPreset[ 'id' ] | 'split';

// The split view reuses the desktop and mobile presets for its two panes.
const MOBILE_PRESET = VIEWPORT_PRESETS[ 0 ];
const DESKTOP_PRESET = VIEWPORT_PRESETS[ 2 ];

// The phone frame's orientation, shared by the mobile preset and the split
// view. Landscape rotates the frame a quarter turn (844×390).
type MobileOrientation = 'portrait' | 'landscape';

const MOBILE_PRESET_LANDSCAPE: ViewportPreset = {
	...MOBILE_PRESET,
	width: MOBILE_PRESET.height ?? MOBILE_PRESET.width,
	height: MOBILE_PRESET.width,
};

function getMobilePreset( orientation: MobileOrientation ): ViewportPreset {
	return orientation === 'landscape' ? MOBILE_PRESET_LANDSCAPE : MOBILE_PRESET;
}

// Best-effort UA sniff: webview is only meaningful inside Electron. Outside
// (e.g. running apps/ui standalone in a regular browser) the tag is inert, so
// we render a plain iframe instead and skip the inspector.
const isElectron = (): boolean => {
	if ( typeof navigator === 'undefined' ) return false;
	return /\bElectron\//.test( navigator.userAgent );
};

function getInitialPreviewColorScheme(): PreviewColorScheme {
	if (
		typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia( '(prefers-color-scheme: dark)' ).matches
	) {
		return 'dark';
	}
	return 'light';
}

/**
 * The viewport to simulate for a preset inside a pane of the given size.
 * Width-only presets fill the pane vertically: wider than the pane → the
 * guest is scaled down to fit its width, with the emulated height extended
 * so the scaled page still fills the pane; narrower → 1:1, letterboxed by
 * the pane. Presets with a fixed height keep their exact dimensions and
 * scale down (never up) to fit both axes, like a device frame.
 */
export function getSimulatedViewport(
	preset: { width: number; height?: number; mobile?: boolean } | null,
	pane: { width: number; height: number } | null
): PreviewViewport | null {
	if ( ! preset || ! pane || pane.width <= 0 || pane.height <= 0 ) {
		return null;
	}
	const mobile = Boolean( preset.mobile );
	if ( preset.height ) {
		return {
			width: preset.width,
			height: preset.height,
			scale: Math.min( 1, pane.width / preset.width, pane.height / preset.height ),
			mobile,
		};
	}
	const scale = Math.min( 1, pane.width / preset.width );
	return {
		width: preset.width,
		height: Math.max( 1, Math.round( pane.height / scale ) ),
		scale,
		mobile,
	};
}

// Where each realm segment lands before its per-realm memory has anything
// better: site root, WP Admin dashboard, and phpMyAdmin's WordPress database.
const DEFAULT_REALM_PATHS: Record< PreviewRealm, string > = {
	frontend: '/',
	admin: '/wp-admin/',
	database: DATABASE_HOME_PATH,
};

// The split buttons fold into the overflow menu below this toolbar width;
// the address segments drop their titles a little earlier via the
// `studio-preview-toolbar` container query in location-omnibox.module.css.
const NARROW_TOOLBAR_WIDTH = 600;

// Breathing room around the split view's phone frame (matches the pane's
// CSS padding, subtracted before computing the frame's fit-to-height scale).
const SPLIT_MOBILE_PANE_PADDING = 16;

const SITE_THUMBNAIL_QUERY_KEY = [ 'site-preview-thumbnail' ] as const;
const DEFAULT_CONSOLE_HEIGHT = 280;
const MIN_CONSOLE_HEIGHT = 168;
const MAX_CONSOLE_HEIGHT = 560;
const MIN_BROWSER_HEIGHT_WHILE_RESIZING = 120;

function normalizeDocumentTitle( value: unknown ) {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getIframeTitle( iframe: HTMLIFrameElement ) {
	try {
		return normalizeDocumentTitle( iframe.contentDocument?.title );
	} catch {
		return null;
	}
}

function getBrowserShortcutDescriptor( key: string ) {
	return {
		displayShortcut: displayShortcut.primary( key ),
		ariaKeyShortcut: ariaKeyShortcut.primary( key ),
	};
}

function getNavigationShortcutDescriptor( direction: 'back' | 'forward' ) {
	const isApple = isAppleOS();
	const arrow = direction === 'back' ? '←' : '→';
	const arrowKey = direction === 'back' ? 'ArrowLeft' : 'ArrowRight';
	const bracket = direction === 'back' ? '[' : ']';
	return {
		displayShortcut: isApple ? `⌘${ arrow }` : `Alt+${ arrow }`,
		ariaKeyShortcut: `${ isApple ? 'Meta' : 'Alt' }+${ arrowKey } ${ ariaKeyShortcut.primary(
			bracket
		) }`,
	};
}

function isTextEntryTarget( target: EventTarget | null ) {
	return (
		target instanceof HTMLElement &&
		( target.isContentEditable ||
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement )
	);
}

export function getBrowserShortcutCommand(
	event: globalThis.KeyboardEvent
): BrowserShortcutCommandType | null {
	if ( event.defaultPrevented || event.repeat ) {
		return null;
	}
	if ( isKeyboardEvent.primary( event, 'r' ) ) {
		return 'reload';
	}
	if ( isKeyboardEvent.primary( event, '[' ) ) {
		return 'back';
	}
	if ( isKeyboardEvent.primary( event, ']' ) ) {
		return 'forward';
	}
	// Layout-independent back/forward aliases (⌘←/⌘→ on macOS, Alt+←/→
	// elsewhere): the bracket chords need Option/AltGr on many European
	// layouts. Skipped while editing text to keep native caret movement.
	if ( isTextEntryTarget( event.target ) ) {
		return null;
	}
	const isNavigationChord = isAppleOS() ? isKeyboardEvent.primary : isKeyboardEvent.alt;
	if ( isNavigationChord( event, 'ArrowLeft' ) ) {
		return 'back';
	}
	if ( isNavigationChord( event, 'ArrowRight' ) ) {
		return 'forward';
	}
	return null;
}

// Preview chrome shortcuts (⇧⌘ on macOS, Ctrl+Shift elsewhere): D flips the
// preview color scheme, F toggles full preview. Handled by the same
// host-document listener as the browser shortcuts; the "•••" menu items
// advertise them.
const COLOR_SCHEME_SHORTCUT_KEY = 'd';
const FULL_PREVIEW_SHORTCUT_KEY = 'f';

function getPreviewChromeShortcut(
	event: globalThis.KeyboardEvent
): 'color-scheme' | 'full-preview' | null {
	if ( event.defaultPrevented || event.repeat ) {
		return null;
	}
	if ( isKeyboardEvent.primaryShift( event, COLOR_SCHEME_SHORTCUT_KEY ) ) {
		return 'color-scheme';
	}
	if ( isKeyboardEvent.primaryShift( event, FULL_PREVIEW_SHORTCUT_KEY ) ) {
		return 'full-preview';
	}
	return null;
}

// ⌘1/⌘2/⌘3 (Ctrl elsewhere) select the address bar's realm segments.
function getRealmShortcut( event: globalThis.KeyboardEvent ): PreviewRealm | null {
	if ( event.defaultPrevented || event.repeat ) {
		return null;
	}
	for ( const realm of Object.keys( REALM_SHORTCUT_KEYS ) as PreviewRealm[] ) {
		if ( isKeyboardEvent.primary( event, REALM_SHORTCUT_KEYS[ realm ] ) ) {
			return realm;
		}
	}
	return null;
}

function ToolbarTooltip( {
	label,
	children,
}: {
	label: string;
	children: ReactElement< Record< string, unknown > >;
} ) {
	return (
		<Tooltip.Root>
			<Tooltip.Trigger render={ children } />
			<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>{ label }</Tooltip.Popup>
		</Tooltip.Root>
	);
}

// Trailing "•••" menu holding the preview's environment controls (responsive
// mode, appearance, full preview) and the occasional actions that don't earn
// a permanent toolbar button (console). All clip actions live in the Clip
// split button; the open-in destinations live in the Open in… split button.
function PreviewOverflowMenu( {
	canPreview,
	canUseWebview,
	viewportMode,
	onViewportModeChange,
	mobileOrientation,
	onMobileOrientationChange,
	colorScheme,
	onColorSchemeChange,
	fullscreen,
	onToggleFullscreen,
	consoleLabel,
	onToggleConsole,
	showDatabaseTab,
	onToggleDatabaseTab,
	onForceSignIn,
	isSignedIn,
	collapsedTools,
}: {
	canPreview: boolean;
	canUseWebview: boolean;
	viewportMode: ViewportMode;
	onViewportModeChange: ( mode: ViewportMode ) => void;
	mobileOrientation: MobileOrientation;
	onMobileOrientationChange: ( orientation: MobileOrientation ) => void;
	colorScheme: PreviewColorScheme;
	onColorSchemeChange: ( scheme: PreviewColorScheme ) => void;
	fullscreen: boolean;
	onToggleFullscreen?: () => void;
	consoleLabel: string;
	onToggleConsole: () => void;
	// Whether the address bar's Database segment is shown, and the toggle for it.
	showDatabaseTab: boolean;
	onToggleDatabaseTab: () => void;
	// Manually run the site's auto-login. Absent when there's no preview to
	// navigate or the site isn't reachable.
	onForceSignIn?: () => void;
	// Disables the sign-in item when the previewed page is already signed in.
	isSignedIn?: boolean;
	// At narrow toolbar widths the Clip and Open in… split buttons fold in
	// here so they can't collide with the address segments.
	collapsedTools?: {
		clip: {
			onRunAction: ( action: PreviewClipAction ) => void;
			pageClipBusy: boolean;
			clipCount: number;
			onClearClips?: () => void;
		} | null;
		openIn: { site: SiteDetails; browserPath?: string };
	} | null;
} ) {
	const viewportLabels: Record< ViewportPreset[ 'id' ], string > = {
		mobile: __( 'Mobile' ),
		tablet: __( 'Tablet' ),
		desktop: __( 'Desktop' ),
	};
	const getPresetLabel = ( preset: ViewportPreset ) => {
		if ( preset.height ) {
			return sprintf(
				/* translators: 1: device name (e.g. Mobile), 2: viewport width, 3: viewport height in pixels */
				__( '%1$s · %2$d×%3$d' ),
				viewportLabels[ preset.id ],
				preset.width,
				preset.height
			);
		}
		return sprintf(
			/* translators: 1: device name (e.g. Tablet), 2: viewport width in pixels */
			__( '%1$s · %2$dpx' ),
			viewportLabels[ preset.id ],
			preset.width
		);
	};
	const colorSchemeShortcut = displayShortcut.primaryShift( COLOR_SCHEME_SHORTCUT_KEY );
	return (
		<Menu.Root modal={ false }>
			<Menu.Trigger
				render={
					<IconButton
						variant="minimal"
						tone="neutral"
						size="small"
						icon={ moreVertical }
						label={ __( 'More options' ) }
					/>
				}
			/>
			<Menu.Popup side="bottom" align="end">
				{ canPreview ? (
					<>
						<Menu.Group>
							<Menu.GroupLabel>{ __( 'Responsive mode' ) }</Menu.GroupLabel>
							<Menu.RadioGroup
								value={ viewportMode }
								onValueChange={ ( next ) => onViewportModeChange( next as ViewportMode ) }
							>
								<Menu.RadioItem value="fit">{ __( 'Fit pane' ) }</Menu.RadioItem>
								{ VIEWPORT_PRESETS.map( ( preset ) => (
									<Menu.RadioItem key={ preset.id } value={ preset.id }>
										{ getPresetLabel(
											// Keep the advertised dimensions honest in landscape.
											preset.id === 'mobile' ? getMobilePreset( mobileOrientation ) : preset
										) }
									</Menu.RadioItem>
								) ) }
								<Menu.RadioItem value="split">{ __( 'Desktop + Mobile' ) }</Menu.RadioItem>
							</Menu.RadioGroup>
						</Menu.Group>
						{ viewportMode === 'mobile' || viewportMode === 'split' ? (
							<>
								<Menu.Separator />
								<Menu.Group>
									<Menu.GroupLabel>{ __( 'Mobile orientation' ) }</Menu.GroupLabel>
									<Menu.RadioGroup
										value={ mobileOrientation }
										onValueChange={ ( next ) =>
											onMobileOrientationChange( next as MobileOrientation )
										}
									>
										<Menu.RadioItem value="portrait">{ __( 'Portrait' ) }</Menu.RadioItem>
										<Menu.RadioItem value="landscape">{ __( 'Landscape' ) }</Menu.RadioItem>
									</Menu.RadioGroup>
								</Menu.Group>
							</>
						) : null }
						<Menu.Separator />
						<Menu.Group>
							<Menu.GroupLabel>{ __( 'Appearance' ) }</Menu.GroupLabel>
							<Menu.RadioGroup
								value={ colorScheme }
								onValueChange={ ( next ) => onColorSchemeChange( next as PreviewColorScheme ) }
							>
								{ /* The toggle shortcut is advertised on the scheme it
									would switch to. */ }
								<Menu.RadioItem
									value="light"
									disabled={ ! canUseWebview }
									shortcut={ colorScheme === 'dark' ? colorSchemeShortcut : undefined }
								>
									{ __( 'Light' ) }
								</Menu.RadioItem>
								<Menu.RadioItem
									value="dark"
									disabled={ ! canUseWebview }
									shortcut={ colorScheme === 'light' ? colorSchemeShortcut : undefined }
								>
									{ __( 'Dark' ) }
								</Menu.RadioItem>
							</Menu.RadioGroup>
						</Menu.Group>
						<Menu.Separator />
						<Menu.Group>
							<Menu.GroupLabel>{ __( 'Tabs' ) }</Menu.GroupLabel>
							<Menu.CheckboxItem
								checked={ showDatabaseTab }
								onCheckedChange={ () => onToggleDatabaseTab() }
							>
								{ __( 'Database tab' ) }
							</Menu.CheckboxItem>
						</Menu.Group>
						<Menu.Separator />
						{ onToggleFullscreen ? (
							<QuickMenuItem
								label={ fullscreen ? __( 'Exit full preview' ) : __( 'Full preview' ) }
								shortcut={ displayShortcut.primaryShift( FULL_PREVIEW_SHORTCUT_KEY ) }
								onClick={ onToggleFullscreen }
							/>
						) : null }
					</>
				) : null }
				<QuickMenuItem
					label={ consoleLabel }
					disabled={ ! canUseWebview }
					onClick={ onToggleConsole }
				/>
				{ onForceSignIn ? (
					<QuickMenuItem
						label={ __( 'Sign in to this site' ) }
						disabled={ isSignedIn }
						tooltip={ isSignedIn ? __( "You're already signed in to this site" ) : undefined }
						onClick={ onForceSignIn }
					/>
				) : null }
				{ collapsedTools ? (
					<>
						<Menu.Separator />
						{ collapsedTools.clip ? (
							<Menu.SubmenuRoot>
								<QuickMenuSubmenuTrigger
									icon={ capturePhoto }
									label={ __( 'Clips' ) }
									flyoutSide="left"
								/>
								<Menu.Popup side="left" align="start">
									{ getClipActions().map( ( action ) => (
										<QuickMenuItem
											key={ action.id }
											icon={ action.icon }
											label={ action.label }
											disabled={ action.id === 'page' && collapsedTools.clip?.pageClipBusy }
											onClick={ () => collapsedTools.clip?.onRunAction( action.id ) }
										/>
									) ) }
									{ collapsedTools.clip.onClearClips ? (
										<>
											<Menu.Separator />
											<QuickMenuItem
												icon={ trash }
												label={ __( 'Clear clips' ) }
												destructive
												disabled={ collapsedTools.clip.clipCount === 0 }
												onClick={ collapsedTools.clip.onClearClips }
											/>
										</>
									) : null }
								</Menu.Popup>
							</Menu.SubmenuRoot>
						) : null }
						<Menu.SubmenuRoot>
							<QuickMenuSubmenuTrigger
								icon={ external }
								label={ __( 'Open in…' ) }
								flyoutSide="left"
							/>
							<Menu.Popup side="left" align="start">
								<OpenInDestinationItems
									site={ collapsedTools.openIn.site }
									browserPath={ collapsedTools.openIn.browserPath }
								/>
							</Menu.Popup>
						</Menu.SubmenuRoot>
					</>
				) : null }
			</Menu.Popup>
		</Menu.Root>
	);
}

// The clip actions, as a split button (like "Open in…"): the main button
// re-runs whatever the user clipped last; the dropdown switches kinds. Each
// action is an explicit mode with its own gestures, so nothing fights the
// page — scrolling only zooms inside the loupe.
type PreviewClipAction = 'element' | 'region' | 'loupe' | 'page';

const CLIP_ACTION_STORAGE_KEY = 'studio:preview-clip-menu:last-used';

// Whether the address bar shows the Database (phpMyAdmin) segment. A global
// preference (like the clip/open-in defaults), remembered across sessions;
// defaults to hidden.
const PREVIEW_SHOW_DATABASE_TAB_STORAGE_KEY = 'studio:preview-show-database-tab';

function getStoredShowDatabaseTab(): boolean {
	try {
		// Only an explicit "true" shows the tab; anything else hides it.
		return window.localStorage.getItem( PREVIEW_SHOW_DATABASE_TAB_STORAGE_KEY ) === 'true';
	} catch {
		return false;
	}
}

function isPreviewClipAction( value: string | null ): value is PreviewClipAction {
	return value === 'element' || value === 'region' || value === 'loupe' || value === 'page';
}

function getStoredClipAction(): PreviewClipAction {
	try {
		const stored = window.localStorage.getItem( CLIP_ACTION_STORAGE_KEY );
		return isPreviewClipAction( stored ) ? stored : 'element';
	} catch {
		return 'element';
	}
}

// Shared by the split button and the narrow-toolbar overflow section.
function getClipActions(): { id: PreviewClipAction; icon: ReactElement; label: string }[] {
	return [
		{ id: 'element', icon: pencil, label: __( 'Clip an element' ) },
		{ id: 'region', icon: crop, label: __( 'Clip a region' ) },
		{ id: 'loupe', icon: search, label: __( 'Clip a detail' ) },
		{ id: 'page', icon: capturePhoto, label: __( 'Clip the page' ) },
	];
}

function PreviewClipMenu( {
	activeMode,
	onSetMode,
	onPageClip,
	pageClipBusy = false,
	clipCount = 0,
	onClearClips,
}: {
	activeMode: InspectorMode;
	onSetMode: ( mode: InspectorMode ) => void;
	onPageClip: () => void;
	// Page clips render in a headless browser and take seconds; the trigger
	// wears a spinner while one is in flight.
	pageClipBusy?: boolean;
	// Pending clips in the composer; enables "Clear clips".
	clipCount?: number;
	onClearClips?: () => void;
} ) {
	const [ lastUsed, setLastUsed ] = useState< PreviewClipAction >( getStoredClipAction );
	const rememberAction = ( action: PreviewClipAction ) => {
		setLastUsed( action );
		try {
			window.localStorage.setItem( CLIP_ACTION_STORAGE_KEY, action );
		} catch {
			// Storage failures only mean the trigger won't persist.
		}
	};
	const actions = getClipActions();
	const runAction = ( action: PreviewClipAction ) => {
		rememberAction( action );
		if ( action === 'page' ) {
			if ( ! pageClipBusy ) {
				onPageClip();
			}
			return;
		}
		onSetMode( activeMode === action ? 'off' : action );
	};
	const isActive = activeMode !== 'off';
	const lastUsedAction = actions.find( ( action ) => action.id === lastUsed ) ?? actions[ 0 ];

	return (
		<Menu.Root modal={ false }>
			<QuickMenuTrigger
				menuLabel={ __( 'Clip…' ) }
				actionLabel={
					pageClipBusy
						? __( 'Clipping the page…' )
						: isActive
						? __( 'Stop clipping' )
						: lastUsedAction.label
				}
				logo={ lastUsedAction.icon }
				busy={ pageClipBusy }
				onActionClick={ () => ( isActive ? onSetMode( 'off' ) : runAction( lastUsed ) ) }
			/>
			<QuickMenuPopup>
				{ actions.map( ( action ) => (
					<QuickMenuItem
						key={ action.id }
						icon={ action.icon }
						label={ action.label }
						disabled={ action.id === 'page' && pageClipBusy }
						onClick={ () => runAction( action.id ) }
					/>
				) ) }
				{ onClearClips ? (
					<>
						<Menu.Separator />
						<QuickMenuItem
							icon={ trash }
							label={ __( 'Clear clips' ) }
							destructive
							disabled={ clipCount === 0 }
							onClick={ onClearClips }
						/>
					</>
				) : null }
			</QuickMenuPopup>
		</Menu.Root>
	);
}

function getConsoleFilterLabel( filter: ConsoleFilter ) {
	switch ( filter ) {
		case 'all':
			return __( 'All' );
		case 'debug':
			return __( 'Debug' );
		case 'log':
			return __( 'Logs' );
		case 'info':
			return __( 'Info' );
		case 'warning':
			return __( 'Warnings' );
		case 'error':
			return __( 'Errors' );
	}
}

function getConsoleEntryLevelLabel( level: PreviewConsoleLevel ) {
	switch ( level ) {
		case 'debug':
			return __( 'Debug' );
		case 'log':
			return __( 'Log' );
		case 'info':
			return __( 'Info' );
		case 'warning':
			return __( 'Warning' );
		case 'error':
			return __( 'Error' );
	}
}

function isConsoleEntryVisible( entry: PreviewConsoleEntry, filter: ConsoleFilter ) {
	if ( filter === 'all' ) {
		return true;
	}
	if ( filter === 'log' ) {
		return entry.level === 'log' || entry.level === 'info' || entry.level === 'debug';
	}
	return entry.level === filter;
}

function formatConsoleEntryTime( timestamp: number ) {
	return new Date( timestamp ).toLocaleTimeString( [], {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	} );
}

function createConsoleTextFile( entries: PreviewConsoleEntry[] ): PreviewConsoleTextFile {
	const timestamp = new Date().toISOString().replace( /[:.]/g, '-' );
	const contents = formatPreviewConsoleEntriesForText( entries );
	return {
		name: `browser-console-${ timestamp }.txt`,
		contents,
		mimeType: 'text/plain',
		size: new Blob( [ contents ], { type: 'text/plain' } ).size,
	};
}

const CONSOLE_FILTERS: ConsoleFilter[] = [ 'all', 'error', 'warning', 'log' ];

function PreviewConsoleDrawer( {
	entries,
	filter,
	hasEntries,
	height,
	isAttaching,
	resizeHandleProps,
	onFilterChange,
	onClear,
	onCopy,
	onAttach,
	onClose,
}: {
	entries: PreviewConsoleEntry[];
	filter: ConsoleFilter;
	hasEntries: boolean;
	height: number;
	isAttaching: boolean;
	resizeHandleProps: Omit<
		ComponentProps< typeof ResizeHandle >,
		'className' | 'label' | 'orientation'
	>;
	onFilterChange: ( filter: ConsoleFilter ) => void;
	onClear: () => void;
	onCopy: () => void;
	onAttach?: () => void;
	onClose: () => void;
} ) {
	return (
		<section
			className={ styles.consoleDrawer }
			aria-label={ __( 'Console' ) }
			style={ { '--preview-console-height': `${ height }px` } as CSSProperties }
		>
			<ResizeHandle
				className={ styles.consoleResizeHandle }
				label={ __( 'Resize console' ) }
				orientation="horizontal"
				{ ...resizeHandleProps }
			/>
			<header className={ styles.consoleHeader }>
				<div className={ styles.consoleTitle }>
					<span className={ styles.consoleTitleIcon } aria-hidden="true">
						<Icon icon={ code } size={ 14 } />
					</span>
					<span>{ __( 'Console' ) }</span>
				</div>
				<div
					className={ styles.consoleFilters }
					role="group"
					aria-label={ __( 'Console filters' ) }
				>
					{ CONSOLE_FILTERS.map( ( option ) => (
						<button
							key={ option }
							type="button"
							className={ styles.consoleFilter }
							aria-pressed={ filter === option }
							onClick={ () => onFilterChange( option ) }
						>
							{ getConsoleFilterLabel( option ) }
						</button>
					) ) }
				</div>
				<div className={ styles.consoleActions }>
					<IconButton
						variant="minimal"
						tone="neutral"
						size="small"
						icon={ copy }
						label={ __( 'Copy visible console messages' ) }
						disabled={ entries.length === 0 }
						onClick={ onCopy }
					/>
					<IconButton
						variant="minimal"
						tone="neutral"
						size="small"
						icon={ fileIcon }
						label={ __( 'Attach visible console messages to composer' ) }
						loading={ isAttaching }
						loadingAnnouncement={ __( 'Attaching console messages' ) }
						disabled={ ! onAttach || entries.length === 0 || isAttaching }
						onClick={ onAttach }
					/>
					<IconButton
						variant="minimal"
						tone="neutral"
						size="small"
						icon={ trash }
						label={ __( 'Clear console' ) }
						disabled={ ! hasEntries }
						onClick={ onClear }
					/>
					<IconButton
						variant="minimal"
						tone="neutral"
						size="small"
						icon={ closeSmall }
						label={ __( 'Close console' ) }
						onClick={ onClose }
					/>
				</div>
			</header>
			<div className={ styles.consoleBody }>
				{ entries.length > 0 ? (
					<ol className={ styles.consoleEntries }>
						{ entries.map( ( entry ) => {
							const source = getPreviewConsoleSourceLabel( entry );
							return (
								<li key={ entry.id } className={ styles.consoleEntry } data-level={ entry.level }>
									<span className={ styles.consoleEntryMeta }>
										<span className={ styles.consoleEntryTime }>
											{ formatConsoleEntryTime( entry.timestamp ) }
										</span>
										<span className={ styles.consoleEntryLevel }>
											{ getConsoleEntryLevelLabel( entry.level ) }
										</span>
									</span>
									<span className={ styles.consoleEntryMessage }>{ entry.message }</span>
									{ source ? (
										<span className={ styles.consoleEntrySource }>{ source }</span>
									) : null }
								</li>
							);
						} ) }
					</ol>
				) : (
					<div className={ styles.consoleEmpty }>
						{ hasEntries
							? __( 'No messages match this filter.' )
							: __( 'No console messages yet.' ) }
					</div>
				) }
			</div>
		</section>
	);
}

export function SitePreview( {
	site,
	path,
	reloadNonce,
	onClip,
	onClipUpdate,
	onClipRemove,
	onComposerText,
	clipMarkers,
	onPathChange,
	collapsed = false,
	fullscreen = false,
	onToggleFullscreen,
	onConsoleEntriesChange,
}: SitePreviewProps ) {
	const connector = useConnector();
	const { chatEnabled } = useAgenticFeatures();
	const startSite = useStartSite();
	const isStarting = useIsSiteStarting( site.id );
	// With the sidebar hidden the split frame goes full-bleed, so the toolbar
	// compensates for the lost frame gap (see .headerSidebarCollapsed).
	const sidebarCollapsed = useSidebarCollapsed();
	// In full preview the sidebar is gone, so the macOS traffic lights sit
	// on top of this toolbar; reserve their corner (the hook is false on
	// other platforms, in the browser, and in OS fullscreen).
	const trafficLightSpace = useTrafficLightSpace();
	const windowControls = useWindowControlsOverlay();
	// Prototype: plugin sites get plugin-flavored copy in the stopped state.
	const pluginTag = usePluginSiteTag( site.id );
	const siteUrl = getSiteUrl( site );
	const canUseWebview = isElectron();
	const canPreview = site.running;
	const previewUrl = `${ siteUrl }${ getSafePath( path ) }`;
	// Site-runtime controls (front-end admin bar, force sign-in) reach the
	// running site over REST / auto-login, which only the on-machine webview
	// connector serves; scope them to it like the omnibox search.
	const canRuntimeControls = canPreview && canUseWebview;
	const [ browserState, setBrowserState ] =
		useState< BrowserNavigationState >( EMPTY_BROWSER_STATE );
	const [ browserCommand, setBrowserCommand ] = useState< BrowserCommand | null >( null );
	const [ inspectorState, setInspectorState ] = useState< InspectorState >( EMPTY_INSPECTOR_STATE );
	const [ inspectorCommand, setInspectorCommand ] = useState< InspectorCommandRequest | null >(
		null
	);
	const [ pageClipRequest, setPageClipRequest ] = useState< PageClipRequest | null >( null );
	const [ isCapturingPageClip, setIsCapturingPageClip ] = useState( false );
	// Read by document-level key handlers without re-subscribing per change.
	const inspectorStateRef = useRef( inspectorState );
	useEffect( () => {
		inspectorStateRef.current = inspectorState;
	}, [ inspectorState ] );
	const [ previewColorScheme, setPreviewColorScheme ] = useState< PreviewColorScheme >(
		getInitialPreviewColorScheme
	);
	// Whether the address bar shows the Database segment (global preference).
	const [ showDatabaseTab, setShowDatabaseTab ] = useState( getStoredShowDatabaseTab );
	// Whether the previewed page shows a signed-in WordPress user (from its
	// `logged-in` body class), so "Sign in to this site" can disable itself.
	const [ previewLoggedIn, setPreviewLoggedIn ] = useState( false );
	// 'fit' renders at the pane's natural size; a preset id simulates that
	// viewport; 'split' shows the desktop and mobile presets together.
	const [ viewportMode, setViewportMode ] = useState< ViewportMode >( 'fit' );
	// Orientation of the phone frame, wherever it shows (mobile preset and
	// the split view's phone pane).
	const [ mobileOrientation, setMobileOrientation ] = useState< MobileOrientation >( 'portrait' );
	// Presets are module constants, so this stays referentially stable per
	// mode + orientation.
	const activePreset =
		viewportMode === 'mobile'
			? getMobilePreset( mobileOrientation )
			: viewportMode === 'split'
			? DESKTOP_PRESET
			: VIEWPORT_PRESETS.find( ( preset ) => preset.id === viewportMode ) ?? null;
	const splitPreview = viewportMode === 'split';
	const [ paneSize, setPaneSize ] = useState< { width: number; height: number } | null >( null );
	const [ consoleEntries, setConsoleEntries ] = useState< PreviewConsoleEntry[] >( [] );
	const [ consoleOpen, setConsoleOpen ] = useState( false );
	const [ consoleFilter, setConsoleFilter ] = useState< ConsoleFilter >( 'all' );
	const [ consoleHeight, setConsoleHeight ] = useState( DEFAULT_CONSOLE_HEIGHT );
	const [ isAttachingConsoleFile, setIsAttachingConsoleFile ] = useState( false );
	const rootRef = useRef< HTMLElement | null >( null );
	const bodyRef = useRef< HTMLDivElement | null >( null );
	const headerRef = useRef< HTMLDivElement | null >( null );
	// Below this toolbar width the Clip and Open in… split buttons fold into
	// the overflow menu so they can't collide with the address segments (the
	// segments' titles collapse a little earlier, via a container query).
	const [ isToolbarNarrow, setIsToolbarNarrow ] = useState( false );
	useEffect( () => {
		const header = headerRef.current;
		if ( ! header || typeof ResizeObserver === 'undefined' ) {
			return;
		}
		const observer = new ResizeObserver( ( entries ) => {
			const width = entries[ entries.length - 1 ]?.contentRect.width;
			if ( typeof width === 'number' ) {
				setIsToolbarNarrow( width < NARROW_TOOLBAR_WIDTH );
			}
		} );
		observer.observe( header );
		return () => observer.disconnect();
	}, [] );
	const locationRef = useRef< HTMLDivElement | null >( null );
	const paneRef = useRef< HTMLDivElement | null >( null );
	const commandIdRef = useRef( 0 );
	const siteThumbnail = useQuery( {
		queryKey: [ ...SITE_THUMBNAIL_QUERY_KEY, site.id ],
		queryFn: () => connector.getSiteThumbnail( site.id ),
		enabled: ! canPreview,
		meta: { persist: false },
	} );
	// Page clips only need the webview (the capture goes through the
	// debugger, not the guest script); mode commands no-op until the
	// inspector script reports ready.
	const canPageClip = canPreview && canUseWebview && !! onClip;
	const progress = browserState.loading
		? Math.max( browserState.progress, 0.12 )
		: browserState.progress;
	const showLoadingProgress = canPreview && progress > 0;
	const visibleConsoleEntries = useMemo(
		() => consoleEntries.filter( ( entry ) => isConsoleEntryVisible( entry, consoleFilter ) ),
		[ consoleEntries, consoleFilter ]
	);
	const consoleButtonLabel = consoleOpen ? __( 'Hide console' ) : __( 'Show console' );

	const handlePreviewNavigation = useCallback(
		( url: string ) => {
			const nextPath = getPathFromPreviewUrl( url, siteUrl );
			if ( ! nextPath || nextPath === path ) {
				return;
			}
			onPathChange?.( nextPath );
		},
		[ onPathChange, path, siteUrl ]
	);
	// Realm segments (front end / WP Admin / database). Each realm remembers
	// where you last were: flipping to WP Admin and back returns to the exact
	// front-end page, and vice versa. Admin targets go through the site's
	// /studio-auto-login endpoint so they never land on the login form.
	const lastRealmPathsRef = useRef< Record< PreviewRealm, string > >( {
		...DEFAULT_REALM_PATHS,
	} );
	useEffect( () => {
		// Reset the per-realm memory when the preview moves to another site.
		lastRealmPathsRef.current = { ...DEFAULT_REALM_PATHS };
	}, [ site.id ] );
	useEffect( () => {
		const safePath = getSafePath( path );
		// Auto-login is a transient hop, not a place to return to.
		if ( safePath.startsWith( '/studio-auto-login' ) ) {
			return;
		}
		lastRealmPathsRef.current[ getPreviewRealm( safePath ) ] = safePath;
	}, [ path ] );
	const handleSwitchRealm = useCallback(
		( realm: PreviewRealm ) => {
			// The database realm is unreachable while its tab is hidden — ignore
			// clicks (there is none) and the ⌘3 shortcut.
			if ( realm === 'database' && ! showDatabaseTab ) {
				return;
			}
			// Re-selecting the active realm (e.g. via its shortcut) is a no-op —
			// don't bounce the current page through another auto-login hop.
			if ( getPreviewRealm( getSafePath( path ) ) === realm ) {
				return;
			}
			const target = lastRealmPathsRef.current[ realm ];
			onPathChange?.( getRealmNavigationPath( target, siteUrl ) );
		},
		[ onPathChange, path, showDatabaseTab, siteUrl ]
	);
	const toggleDatabaseTab = useCallback( () => {
		const next = ! showDatabaseTab;
		setShowDatabaseTab( next );
		try {
			window.localStorage.setItem( PREVIEW_SHOW_DATABASE_TAB_STORAGE_KEY, next ? 'true' : 'false' );
		} catch {
			// Storage failures only mean the preference won't persist.
		}
		// Hiding the tab while viewing the database leaves nowhere to go — fall
		// back to the front end.
		if ( ! next && getPreviewRealm( getSafePath( path ) ) === 'database' ) {
			onPathChange?.( getRealmNavigationPath( lastRealmPathsRef.current.frontend, siteUrl ) );
		}
	}, [ onPathChange, path, showDatabaseTab, siteUrl ] );
	// Manually run the site's auto-login and return to the current page. For the
	// times it doesn't happen on its own; harmless when already signed in.
	const handleForceSignIn = useCallback( () => {
		const current = getSafePath( path );
		// Don't nest an auto-login inside another; just land on the site root.
		const destination = current.startsWith( '/studio-auto-login' ) ? '/' : current;
		const redirectTo = new URL( destination, siteUrl ).toString();
		onPathChange?.( `/studio-auto-login?redirect_to=${ encodeURIComponent( redirectTo ) }` );
	}, [ onPathChange, path, siteUrl ] );
	const handleBrowserStateChange = useCallback( ( state: BrowserNavigationState ) => {
		setBrowserState( ( current ) => ( areBrowserStatesEqual( current, state ) ? current : state ) );
	}, [] );
	const handleInspectorState = useCallback( ( state: InspectorState ) => {
		setInspectorState( state );
	}, [] );
	const handleConsoleEntry = useCallback( ( entry: PreviewConsoleEntry ) => {
		setConsoleEntries( ( current ) => [ ...current, entry ].slice( -MAX_PREVIEW_CONSOLE_ENTRIES ) );
	}, [] );
	const clearConsoleEntries = useCallback( () => {
		setConsoleEntries( [] );
	}, [] );
	const copyVisibleConsoleEntries = useCallback( () => {
		void connector
			.copyText( formatPreviewConsoleEntriesForText( visibleConsoleEntries ) )
			// The stable id collapses rapid re-copies into one toast.
			.then( () => toast.success( __( 'Copied' ), { id: 'copy-feedback' } ) )
			.catch( () => {
				// Clipboard failures are non-fatal; the console remains visible.
			} );
	}, [ connector, visibleConsoleEntries ] );
	// Preview state every clip carries: which realm/page it was made on and
	// how the preview was set up at the time. Restorable context for the
	// agent ("mobile viewport, dark mode, WP Admin").
	const buildClipInput = useCallback(
		( raw: RawClipCapture ): ComposerClipInput => {
			const names: Record< RawClipCapture[ 'grain' ], string > = {
				element: __( 'Element clip' ),
				region: __( 'Region clip' ),
				page: __( 'Page clip' ),
				console: __( 'Console clip' ),
			};
			return {
				grain: raw.grain,
				name: names[ raw.grain ],
				comment: raw.comment,
				target: raw.target,
				documentRect: raw.documentRect,
				coveredTag: raw.coveredTag,
				coveredSelector: raw.coveredSelector,
				zoom: raw.zoom,
				image: raw.image,
				context: {
					realm: getPreviewRealm( getSafePath( path ) ),
					url: raw.url,
					pathname: raw.pathname,
					// Clips capture the primary surface, which renders at natural
					// size in both 'fit' and 'split' modes.
					viewportWidth: activePreset?.width ?? null,
					colorScheme: previewColorScheme,
				},
			};
		},
		[ activePreset, path, previewColorScheme ]
	);
	const handleClipCapture = useCallback(
		async ( raw: RawClipCapture ) => {
			await onClip?.( buildClipInput( raw ) );
		},
		[ buildClipInput, onClip ]
	);
	// Clips are composer attachments; clearing removes each one there, and
	// the marker sync takes the on-page markers with them.
	const clearClips = useCallback( () => {
		for ( const marker of clipMarkers ?? [] ) {
			onClipRemove?.( marker.id );
		}
	}, [ clipMarkers, onClipRemove ] );
	// The headless page-clip browser has no cookies; send admin/database
	// URLs through the site's auto-login endpoint so they don't capture the
	// login form.
	const resolvePageClipUrl = useCallback(
		( url: string ) => {
			const clipPath = getPathFromPreviewUrl( url, siteUrl );
			if ( ! clipPath ) {
				return url;
			}
			return `${ siteUrl }${ getRealmNavigationPath( clipPath, siteUrl ) }`;
		},
		[ siteUrl ]
	);
	const handleTextSelection = useCallback(
		( text: string, pathname: string ) => {
			if ( ! onComposerText ) {
				return;
			}
			const quoted = text
				.split( '\n' )
				.map( ( line ) => `> ${ line }` )
				.join( '\n' );
			onComposerText( pathname ? `${ quoted }\n\n(from ${ pathname })` : quoted );
		},
		[ onComposerText ]
	);
	const attachVisibleConsoleEntries = useCallback( async () => {
		if ( ! onClip || visibleConsoleEntries.length === 0 || isAttachingConsoleFile ) {
			return;
		}
		setIsAttachingConsoleFile( true );
		try {
			const file = createConsoleTextFile( visibleConsoleEntries );
			const filePath = await connector.createTemporaryTextFile( file.name, file.contents );
			await onClip( {
				...buildClipInput( { grain: 'console' } ),
				filePath,
				fileSize: file.size,
				entryCount: visibleConsoleEntries.length,
			} );
		} catch ( error ) {
			console.error( 'Failed to attach console messages:', error );
			toast.error( __( 'Console messages could not be attached.' ) );
		} finally {
			setIsAttachingConsoleFile( false );
		}
	}, [ buildClipInput, connector, isAttachingConsoleFile, onClip, visibleConsoleEntries ] );
	const getMaxConsoleHeight = useCallback( () => {
		const bodyHeight = bodyRef.current?.getBoundingClientRect().height;
		if ( ! bodyHeight ) {
			return MAX_CONSOLE_HEIGHT;
		}
		return Math.max(
			MIN_CONSOLE_HEIGHT,
			Math.min( MAX_CONSOLE_HEIGHT, bodyHeight - MIN_BROWSER_HEIGHT_WHILE_RESIZING )
		);
	}, [] );
	const clampConsoleHeight = useCallback(
		( next: number ) => Math.min( getMaxConsoleHeight(), Math.max( MIN_CONSOLE_HEIGHT, next ) ),
		[ getMaxConsoleHeight ]
	);
	const saveConsoleHeight = useCallback(
		( next: number ) => {
			const clampedHeight = clampConsoleHeight( next );
			setConsoleHeight( clampedHeight );
			return clampedHeight;
		},
		[ clampConsoleHeight ]
	);
	const {
		isDragging: isResizingConsole,
		onMouseDown: handleConsoleResizeStart,
		cancel: cancelConsoleResize,
	} = usePointerDrag( {
		axis: 'y',
		cursor: 'row-resize',
		onStart: () => consoleHeight,
		onMove: ( start, deltaY ) => {
			const nextHeight = clampConsoleHeight( start - deltaY );
			setConsoleHeight( nextHeight );
			return nextHeight;
		},
		onCommit: ( latest ) => {
			saveConsoleHeight( latest );
		},
	} );
	const handleConsoleResizeKeyDown = useCallback(
		( event: ReactKeyboardEvent< HTMLDivElement > ) => {
			if (
				event.key !== 'ArrowUp' &&
				event.key !== 'ArrowDown' &&
				event.key !== 'Home' &&
				event.key !== 'End'
			) {
				return;
			}
			event.preventDefault();
			if ( event.key === 'Home' ) {
				saveConsoleHeight( MIN_CONSOLE_HEIGHT );
				return;
			}
			if ( event.key === 'End' ) {
				saveConsoleHeight( getMaxConsoleHeight() );
				return;
			}
			saveConsoleHeight( consoleHeight + ( event.key === 'ArrowUp' ? 24 : -24 ) );
		},
		[ consoleHeight, getMaxConsoleHeight, saveConsoleHeight ]
	);
	const sendBrowserCommand = useCallback( ( type: BrowserCommand[ 'type' ] ) => {
		commandIdRef.current += 1;
		setBrowserCommand( { id: commandIdRef.current, type } );
	}, [] );
	const sendInspectorCommand = useCallback( ( command: InspectorHostCommand ) => {
		commandIdRef.current += 1;
		setInspectorCommand( { id: commandIdRef.current, command } );
	}, [] );
	const requestPageClip = useCallback( () => {
		if ( ! canPageClip || isCapturingPageClip ) {
			return;
		}
		commandIdRef.current += 1;
		setPageClipRequest( { id: commandIdRef.current } );
	}, [ canPageClip, isCapturingPageClip ] );
	// Runs a clip action from the collapsed (narrow-toolbar) menu items;
	// the split button owns its own copy of this toggle logic.
	const runClipAction = useCallback(
		( action: PreviewClipAction ) => {
			if ( action === 'page' ) {
				requestPageClip();
				return;
			}
			sendInspectorCommand( {
				type: 'set-mode',
				mode: inspectorState.mode === action ? 'off' : action,
			} );
		},
		[ inspectorState.mode, requestPageClip, sendInspectorCommand ]
	);
	const togglePreviewColorScheme = useCallback( () => {
		setPreviewColorScheme( ( current ) => ( current === 'dark' ? 'light' : 'dark' ) );
	}, [] );

	const browserShortcuts = useMemo(
		() => ( {
			back: getNavigationShortcutDescriptor( 'back' ),
			forward: getNavigationShortcutDescriptor( 'forward' ),
			reload: getBrowserShortcutDescriptor( 'r' ),
		} ),
		[]
	);
	const refreshTooltipLabel = `${ __( 'Refresh' ) } ${ browserShortcuts.reload.displayShortcut }`;
	const viewportBySiteRef = useRef<
		Record< string, { mode?: ViewportMode; orientation?: MobileOrientation } >
	>( {} );
	const handleViewportModeChange = useCallback(
		( mode: ViewportMode ) => {
			setViewportMode( mode );
			viewportBySiteRef.current[ site.id ] = { ...viewportBySiteRef.current[ site.id ], mode };
			if ( mode === 'split' && ! fullscreen ) {
				onToggleFullscreen?.();
			}
		},
		[ fullscreen, onToggleFullscreen, site.id ]
	);
	const handleMobileOrientationChange = useCallback(
		( orientation: MobileOrientation ) => {
			setMobileOrientation( orientation );
			viewportBySiteRef.current[ site.id ] = {
				...viewportBySiteRef.current[ site.id ],
				orientation,
			};
		},
		[ site.id ]
	);

	const previousFullscreenRef = useRef( fullscreen );
	const fullscreenRef = useRef( fullscreen );
	const hasFullscreenToggleRef = useRef( Boolean( onToggleFullscreen ) );
	useEffect( () => {
		const wasFullscreen = previousFullscreenRef.current;
		previousFullscreenRef.current = fullscreen;
		fullscreenRef.current = fullscreen;
		hasFullscreenToggleRef.current = Boolean( onToggleFullscreen );
		if ( onToggleFullscreen && wasFullscreen && ! fullscreen && viewportMode === 'split' ) {
			handleViewportModeChange( 'fit' );
		}
	}, [ fullscreen, handleViewportModeChange, onToggleFullscreen, viewportMode ] );

	useEffect( () => {
		setBrowserState( EMPTY_BROWSER_STATE );
		setInspectorState( EMPTY_INSPECTOR_STATE );
		setConsoleEntries( [] );
		setConsoleOpen( false );
		setConsoleHeight( DEFAULT_CONSOLE_HEIGHT );
		const rememberedViewport = viewportBySiteRef.current[ site.id ];
		const rememberedMode = rememberedViewport?.mode ?? 'fit';
		setViewportMode(
			hasFullscreenToggleRef.current && ! fullscreenRef.current && rememberedMode === 'split'
				? 'fit'
				: rememberedMode
		);
		setMobileOrientation( rememberedViewport?.orientation ?? 'portrait' );
		setPreviewLoggedIn( false );
	}, [ site.id ] );

	// The simulated viewport is derived from the pane's size, so it has to
	// follow pane resizes live. Rounded to whole px so subpixel resize
	// reports don't churn re-renders and emulation calls.
	useEffect( () => {
		const pane = paneRef.current;
		if ( ! pane || typeof ResizeObserver === 'undefined' ) {
			return;
		}
		const observer = new ResizeObserver( ( entries ) => {
			const rect = entries[ entries.length - 1 ]?.contentRect;
			if ( ! rect ) {
				return;
			}
			const width = Math.round( rect.width );
			const height = Math.round( rect.height );
			setPaneSize( ( current ) =>
				current?.width === width && current?.height === height ? current : { width, height }
			);
		} );
		observer.observe( pane );
		return () => observer.disconnect();
	}, [] );

	// The split view's phone pane: the mobile preset (in its current
	// orientation) scaled to fit the pane height, and capped at half the
	// pane's width so a landscape frame can't crowd out the primary view.
	const splitMobileViewport = useMemo( () => {
		if ( ! splitPreview || ! paneSize ) {
			return null;
		}
		const preset = getMobilePreset( mobileOrientation );
		return getSimulatedViewport( preset, {
			width: Math.max( 160, Math.min( preset.width, Math.round( paneSize.width / 2 ) ) ),
			height: Math.max( 120, paneSize.height - SPLIT_MOBILE_PANE_PADDING * 2 ),
		} );
	}, [ mobileOrientation, paneSize, splitPreview ] );
	// In split mode the desktop simulation fits the space left beside the
	// rendered mobile frame, including its pane padding. This keeps the page
	// at the desktop breakpoint even when the comparison itself is narrow.
	const primaryPaneSize = useMemo( () => {
		if ( ! splitPreview || ! paneSize || ! splitMobileViewport ) {
			return paneSize;
		}
		const mobilePaneWidth =
			splitMobileViewport.width * splitMobileViewport.scale + SPLIT_MOBILE_PANE_PADDING * 2;
		return {
			width: Math.max( 1, paneSize.width - mobilePaneWidth ),
			height: paneSize.height,
		};
	}, [ paneSize, splitMobileViewport, splitPreview ] );
	const previewViewport = useMemo(
		() => getSimulatedViewport( activePreset, primaryPaneSize ),
		[ activePreset, primaryPaneSize ]
	);
	// Fixed-height presets present as a centered device frame instead of a
	// pane-filling column.
	const isDeviceViewport = Boolean( previewViewport && activePreset?.height );
	// Sizing for the frame around the primary surface: device presets get
	// their exact scaled box (the emulation paints it edge to edge);
	// width-only presets narrower than the pane letterbox 1:1; wider ones
	// fill the pane and let the emulation scale inside it.
	const frameStyle = useMemo< CSSProperties | undefined >( () => {
		if ( ! previewViewport ) {
			return undefined;
		}
		if ( isDeviceViewport ) {
			return {
				flex: '0 0 auto',
				width: previewViewport.width * previewViewport.scale,
				height: previewViewport.height * previewViewport.scale,
			};
		}
		return previewViewport.scale === 1
			? { flex: '0 0 auto', width: previewViewport.width }
			: undefined;
	}, [ isDeviceViewport, previewViewport ] );
	// The iframe fallback has no device emulation, so scaling is a CSS
	// transform instead: lay out at full size, scale down to fit; the frame
	// clips the transform's leftover layout box.
	const iframeStyle: CSSProperties | undefined =
		previewViewport && previewViewport.scale !== 1
			? {
					flex: '0 0 auto',
					width: previewViewport.width,
					height: previewViewport.height,
					transform: `scale(${ previewViewport.scale })`,
					transformOrigin: 'top left',
			  }
			: undefined;

	useEffect( () => {
		onConsoleEntriesChange?.( consoleEntries );
	}, [ consoleEntries, onConsoleEntriesChange ] );

	useEffect( () => {
		if ( ! consoleOpen ) {
			cancelConsoleResize();
		}
	}, [ cancelConsoleResize, consoleOpen ] );

	// Browser shortcuts (⌘R / ⌘[ / ⌘]) pressed while focus is in the host
	// document. Shortcuts pressed inside the guest page are forwarded by the
	// inspector script through the console bridge instead.
	useEffect( () => {
		if ( ! canPreview || collapsed ) {
			return;
		}
		const handleKeyDown = ( event: globalThis.KeyboardEvent ) => {
			const command = getBrowserShortcutCommand( event );
			const realm = command ? null : getRealmShortcut( event );
			const chrome = command || realm ? null : getPreviewChromeShortcut( event );
			// Chrome shortcuts only claim the keystroke when their action is
			// actually available (color scheme needs the webview's emulation,
			// full preview needs a host-provided toggle).
			const chromeEnabled =
				( chrome === 'color-scheme' && canUseWebview ) ||
				( chrome === 'full-preview' && !! onToggleFullscreen );
			if ( ! command && ! realm && ! chromeEnabled ) {
				return;
			}
			const activeElement = document.activeElement;
			if (
				activeElement &&
				activeElement !== document.body &&
				! rootRef.current?.contains( activeElement )
			) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			if ( command ) {
				sendBrowserCommand( command );
			} else if ( realm ) {
				handleSwitchRealm( realm );
			} else if ( chrome === 'color-scheme' ) {
				togglePreviewColorScheme();
			} else if ( chrome === 'full-preview' ) {
				onToggleFullscreen?.();
			}
		};

		document.addEventListener( 'keydown', handleKeyDown, { capture: true } );
		return () => document.removeEventListener( 'keydown', handleKeyDown, { capture: true } );
	}, [
		canPreview,
		canUseWebview,
		collapsed,
		handleSwitchRealm,
		onToggleFullscreen,
		sendBrowserCommand,
		togglePreviewColorScheme,
	] );

	// Escape pressed while focus is in the host document exits the active
	// clip mode (the guest handles Escape itself when focused).
	useEffect( () => {
		if ( ! canPreview || collapsed || ! canUseWebview ) {
			return;
		}
		const handleKeyDown = ( event: globalThis.KeyboardEvent ) => {
			if ( event.key !== 'Escape' || inspectorStateRef.current.mode === 'off' ) {
				return;
			}
			const activeElement = document.activeElement;
			if (
				activeElement &&
				activeElement !== document.body &&
				! rootRef.current?.contains( activeElement )
			) {
				return;
			}
			sendInspectorCommand( { type: 'set-mode', mode: 'off' } );
		};
		document.addEventListener( 'keydown', handleKeyDown, { capture: true } );
		return () => document.removeEventListener( 'keydown', handleKeyDown, { capture: true } );
	}, [ canPreview, canUseWebview, collapsed, sendInspectorCommand ] );

	return (
		<aside
			ref={ rootRef }
			className={ clsx( styles.root, fullscreen && styles.rootFullscreen ) }
			aria-label={ __( 'Site preview' ) }
		>
			<div
				ref={ headerRef }
				className={ clsx(
					styles.header,
					sidebarCollapsed && styles.headerSidebarCollapsed,
					fullscreen && trafficLightSpace.start && styles.headerTrafficLights
				) }
				style={
					windowControls
						? {
								minHeight: windowControls.height,
								paddingInlineEnd: windowControls.controlsWidth + 12,
						  }
						: trafficLightSpace.end
						? { paddingInlineEnd: 96 }
						: undefined
				}
			>
				{ /* Equal-flex side tracks keep the address control truly centered
					in the toolbar regardless of what each side holds. */ }
				<div className={ styles.headerSide }>
					{ canPreview ? (
						<ToolbarTooltip label={ refreshTooltipLabel.trim() }>
							<Button
								variant="minimal"
								tone="neutral"
								size="small"
								className={ styles.refreshButton }
								aria-label={ __( 'Refresh' ) }
								aria-keyshortcuts={ browserShortcuts.reload.ariaKeyShortcut }
								onClick={ () => sendBrowserCommand( 'reload' ) }
							>
								<span className={ styles.refreshIcon } aria-hidden="true">
									{ refreshIcon }
								</span>
							</Button>
						</ToolbarTooltip>
					) : null }
				</div>
				{ /* Back/forward flank the address segments so history controls sit
					with the place they navigate; symmetric widths keep the segments
					(and the omnibox popup anchored to this element) centered. */ }
				<div ref={ locationRef } className={ styles.browserLocation }>
					{ canPreview ? (
						<>
							<IconButton
								variant="minimal"
								tone="neutral"
								size="small"
								icon={ chevronLeft }
								label={ __( 'Back' ) }
								shortcut={ browserShortcuts.back }
								disabled={ ! browserState.canGoBack }
								onClick={ () => sendBrowserCommand( 'back' ) }
							/>
							<PreviewAddressBar
								site={ site }
								siteUrl={ siteUrl }
								path={ getSafePath( path ) }
								searchEnabled={ canUseWebview }
								anchorRef={ locationRef }
								showDatabaseTab={ showDatabaseTab }
								onNavigate={ ( nextPath ) => onPathChange?.( nextPath ) }
								onSwitchRealm={ handleSwitchRealm }
							/>
							<IconButton
								variant="minimal"
								tone="neutral"
								size="small"
								icon={ chevronRight }
								label={ __( 'Forward' ) }
								shortcut={ browserShortcuts.forward }
								disabled={ ! browserState.canGoForward }
								onClick={ () => sendBrowserCommand( 'forward' ) }
							/>
						</>
					) : null }
				</div>
				<div className={ clsx( styles.headerSide, styles.headerSideEnd ) }>
					{ ! isToolbarNarrow &&
					canPreview &&
					chatEnabled &&
					connector.capabilities.annotatePreview &&
					onClip &&
					canUseWebview ? (
						<PreviewClipMenu
							activeMode={ inspectorState.mode }
							onSetMode={ ( nextMode ) =>
								sendInspectorCommand( { type: 'set-mode', mode: nextMode } )
							}
							onPageClip={ requestPageClip }
							pageClipBusy={ isCapturingPageClip }
							clipCount={ clipMarkers?.length ?? 0 }
							onClearClips={ onClipRemove ? clearClips : undefined }
						/>
					) : null }
					{ ! isToolbarNarrow ? (
						<OpenInMenu site={ site } browserPath={ getSafePath( path ) } />
					) : null }
					<PreviewOverflowMenu
						canPreview={ canPreview }
						canUseWebview={ canUseWebview }
						viewportMode={ viewportMode }
						onViewportModeChange={ handleViewportModeChange }
						mobileOrientation={ mobileOrientation }
						onMobileOrientationChange={ handleMobileOrientationChange }
						colorScheme={ previewColorScheme }
						onColorSchemeChange={ setPreviewColorScheme }
						fullscreen={ fullscreen }
						onToggleFullscreen={ onToggleFullscreen }
						consoleLabel={ consoleButtonLabel }
						onToggleConsole={ () => setConsoleOpen( ( current ) => ! current ) }
						showDatabaseTab={ showDatabaseTab }
						onToggleDatabaseTab={ toggleDatabaseTab }
						onForceSignIn={ canRuntimeControls && onPathChange ? handleForceSignIn : undefined }
						isSignedIn={ previewLoggedIn }
						collapsedTools={
							isToolbarNarrow
								? {
										clip:
											canPreview &&
											chatEnabled &&
											connector.capabilities.annotatePreview &&
											onClip &&
											canUseWebview
												? {
														onRunAction: runClipAction,
														pageClipBusy: isCapturingPageClip,
														clipCount: clipMarkers?.length ?? 0,
														onClearClips: onClipRemove ? clearClips : undefined,
												  }
												: null,
										openIn: { site, browserPath: getSafePath( path ) },
								  }
								: null
						}
					/>
				</div>
				{ showLoadingProgress ? (
					<div className={ styles.loadingProgress } aria-hidden="true">
						<span style={ { transform: `scaleX(${ Math.min( progress, 1 ) })` } } />
					</div>
				) : null }
			</div>
			<div ref={ bodyRef } className={ styles.body }>
				<div
					ref={ paneRef }
					className={ clsx(
						styles.previewViewport,
						previewViewport && styles.previewViewportSimulated,
						isDeviceViewport && styles.previewViewportDevice
					) }
				>
					{ canPreview ? (
						<>
							{ previewViewport ? (
								<div className={ styles.viewportGrid } aria-hidden="true">
									<DotGrid
										spacing={ 32 }
										crossSize={ 5 }
										crossThickness={ 0.75 }
										opacity={ 0.16 }
										intro={ false }
									/>
								</div>
							) : null }
							<div
								className={ clsx( styles.surfaceFrame, isDeviceViewport && styles.deviceFrame ) }
								style={ frameStyle }
							>
								{ canUseWebview ? (
									<WebviewSurface
										key={ site.id }
										url={ previewUrl }
										reloadNonce={ reloadNonce }
										onInspectorState={ handleInspectorState }
										inspectorCommand={ inspectorCommand }
										browserCommand={ browserCommand }
										onBrowserStateChange={ handleBrowserStateChange }
										onBrowserCommand={ sendBrowserCommand }
										onNavigate={ handlePreviewNavigation }
										onLoggedInChange={ setPreviewLoggedIn }
										colorScheme={ previewColorScheme }
										viewport={ previewViewport }
										onConsoleEntry={ handleConsoleEntry }
										clipMarkers={ clipMarkers }
										pageClipRequest={ pageClipRequest }
										resolvePageClipUrl={ resolvePageClipUrl }
										onPageClipBusyChange={ setIsCapturingPageClip }
										onClipCapture={ onClip ? handleClipCapture : undefined }
										onClipUpdate={ onClipUpdate }
										onClipRemove={ onClipRemove }
										onTextSelection={ onComposerText ? handleTextSelection : undefined }
									/>
								) : (
									// Non-Electron fallback: plain iframe, no inspector. Reloads
									// by remounting; back/forward aren't reachable from the host.
									<iframe
										key={ `${ previewUrl }#${ reloadNonce }#${
											browserCommand?.type === 'reload' ? browserCommand.id : 0
										}` }
										className={ styles.iframe }
										style={ iframeStyle }
										src={ previewUrl }
										title={ site.name }
										onLoad={ ( event ) => {
											handlePreviewNavigation( event.currentTarget.src );
											setBrowserState( ( current ) => {
												const next = {
													...current,
													loading: false,
													progress: 0,
													title: getIframeTitle( event.currentTarget ),
												};
												return areBrowserStatesEqual( current, next ) ? current : next;
											} );
										} }
									/>
								) }
							</div>
							{ splitPreview && splitMobileViewport ? (
								// The comparison's phone pane: a lean companion surface that
								// follows the primary's navigation (shared `path`) but keeps
								// clips, console, and history on the primary pane.
								<div className={ styles.splitMobilePane }>
									<div className={ styles.viewportGrid } aria-hidden="true">
										<DotGrid
											spacing={ 32 }
											crossSize={ 5 }
											crossThickness={ 0.75 }
											opacity={ 0.16 }
											intro={ false }
										/>
									</div>
									<div
										className={ clsx( styles.surfaceFrame, styles.deviceFrame ) }
										style={ {
											flex: '0 0 auto',
											width: splitMobileViewport.width * splitMobileViewport.scale,
											height: splitMobileViewport.height * splitMobileViewport.scale,
										} }
									>
										{ canUseWebview ? (
											<WebviewSurface
												key={ `${ site.id }-mobile` }
												url={ previewUrl }
												reloadNonce={ reloadNonce }
												colorScheme={ previewColorScheme }
												viewport={ splitMobileViewport }
												browserCommand={ browserCommand?.type === 'reload' ? browserCommand : null }
												onNavigate={ handlePreviewNavigation }
											/>
										) : (
											<iframe
												key={ `${ previewUrl }#${ reloadNonce }` }
												className={ styles.iframe }
												style={
													splitMobileViewport.scale !== 1
														? {
																flex: '0 0 auto',
																width: splitMobileViewport.width,
																height: splitMobileViewport.height,
																transform: `scale(${ splitMobileViewport.scale })`,
																transformOrigin: 'top left',
														  }
														: undefined
												}
												src={ previewUrl }
												title={ sprintf(
													/* translators: %s: site name */
													__( '%s (mobile)' ),
													site.name
												) }
											/>
										) }
									</div>
								</div>
							) : null }
						</>
					) : (
						<div className={ styles.empty }>
							<div className={ styles.emptyGrid } aria-hidden="true">
								<DotGrid
									spacing={ 32 }
									crossSize={ 5 }
									crossThickness={ 0.75 }
									opacity={ 0.16 }
									intro={ false }
								/>
							</div>
							<div className={ styles.emptyContent }>
								{ siteThumbnail.data ? (
									<div className={ styles.emptyThumbnail }>
										<img
											src={ siteThumbnail.data }
											alt={ sprintf( __( 'Screenshot of %s' ), site.name ) }
										/>
									</div>
								) : null }
								<p className={ styles.emptyText }>
									{ pluginTag
										? __( 'Start the plugin to see a live preview.' )
										: __( 'Start the site to see a live preview.' ) }
								</p>
								<Button
									variant="solid"
									tone="brand"
									className={ styles.startButton }
									loading={ isStarting }
									loadingAnnouncement={
										pluginTag ? __( 'Starting plugin' ) : __( 'Starting site' )
									}
									onClick={ () => startSite.mutate( site.id ) }
								>
									<span className={ styles.startIcon } aria-hidden="true">
										{ playIcon }
									</span>
									{ pluginTag ? __( 'Start plugin' ) : __( 'Start site' ) }
								</Button>
							</div>
						</div>
					) }
				</div>
				{ canPreview && consoleOpen ? (
					<PreviewConsoleDrawer
						entries={ visibleConsoleEntries }
						filter={ consoleFilter }
						hasEntries={ consoleEntries.length > 0 }
						height={ consoleHeight }
						isAttaching={ isAttachingConsoleFile }
						resizeHandleProps={ {
							minWidth: MIN_CONSOLE_HEIGHT,
							maxWidth: MAX_CONSOLE_HEIGHT,
							width: Math.min( MAX_CONSOLE_HEIGHT, consoleHeight ),
							isResizing: isResizingConsole,
							onResizeStart: handleConsoleResizeStart,
							onKeyDown: handleConsoleResizeKeyDown,
						} }
						onFilterChange={ setConsoleFilter }
						onClear={ clearConsoleEntries }
						onCopy={ copyVisibleConsoleEntries }
						onAttach={ onClip ? () => void attachVisibleConsoleEntries() : undefined }
						onClose={ () => setConsoleOpen( false ) }
					/>
				) : null }
				{ isResizingConsole ? <ResizeOverlay orientation="horizontal" /> : null }
			</div>
		</aside>
	);
}

function getSafePath( path: unknown ) {
	return typeof path === 'string' && path.trim() ? path : '/';
}
