import {
	areBrowserStatesEqual,
	EMPTY_BROWSER_STATE,
	type BrowserCommand,
	type BrowserNavigationState,
} from './browser-state';
import type { PreviewRealm } from './address-bar';

/**
 * Realms that share a browsing session share a surface.
 *
 * The front end and WP Admin link to each other and share a login, so they stay
 * one webview: one history stack, and a page loaded after signing in reflects
 * it. phpMyAdmin is a separate tool nothing links to, and the only realm that
 * isn't responsive — so it gets its own surface, which never resizes when the
 * preview flips to it. The design system and the site's email aren't web
 * pages: Studio renders them.
 */
export type PreviewSurfaceKey = 'site' | 'database' | 'email' | 'design';

export function getSurfaceKey( realm: PreviewRealm ): PreviewSurfaceKey {
	return realm === 'frontend' || realm === 'admin' ? 'site' : realm;
}

// A mounted preview surface: its url, plus the load state and pending commands
// belonging to that webview. Kept alive once created so returning to it is a
// reload at its own size rather than a resize plus a fresh load.
export interface PreviewSurfaceState {
	path: string;
	browser: BrowserNavigationState;
	// The annotation inspector is running in the page.
	inspectorReady: boolean;
	browserCommand: BrowserCommand | null;
	// The last reload command, which a frame applies by remounting. Kept apart
	// from `browserCommand` so a later back or forward doesn't remount it again.
	reloadCommandId: number;
	reloadNonce: number;
}

type PreviewSurfaces = Partial< Record< PreviewSurfaceKey, PreviewSurfaceState > >;

// Surfaces belong to the site they were opened for, so the owning id travels
// with them: moving to another site replaces the whole set rather than leaving
// the previous site's webviews behind.
export interface MountedSurfaces {
	siteId: string;
	byKey: PreviewSurfaces;
}

export function createPreviewSurface( path: string, reloadNonce: number ): PreviewSurfaceState {
	return {
		path,
		browser: EMPTY_BROWSER_STATE,
		inspectorReady: false,
		browserCommand: null,
		reloadCommandId: 0,
		reloadNonce,
	};
}

function arePreviewSurfacesEqual( a: PreviewSurfaceState, b: PreviewSurfaceState ) {
	return (
		a.path === b.path &&
		a.reloadNonce === b.reloadNonce &&
		a.browserCommand === b.browserCommand &&
		a.reloadCommandId === b.reloadCommandId &&
		a.inspectorReady === b.inspectorReady &&
		areBrowserStatesEqual( a.browser, b.browser )
	);
}

// Returns `current` itself when the patch changes nothing, so state stays put.
export function patchMountedSurface(
	current: MountedSurfaces,
	key: PreviewSurfaceKey,
	patch: Partial< PreviewSurfaceState >
): MountedSurfaces {
	const surface = current.byKey[ key ];
	if ( ! surface ) {
		return current;
	}
	const next = { ...surface, ...patch };
	return arePreviewSurfacesEqual( surface, next )
		? current
		: { ...current, byKey: { ...current.byKey, [ key ]: next } };
}

// Point the active surface at the path the host asks for, creating it the first
// time it's needed. The other surface keeps the url it was left on, so it
// doesn't reload. A brand-new surface starts level with the host's reload
// nonce, so mounting it doesn't count as a reload request.
export function aimMountedSurface(
	current: MountedSurfaces,
	siteId: string,
	key: PreviewSurfaceKey,
	path: string,
	reloadNonce: number
): MountedSurfaces {
	const mounted = createPreviewSurface( path, reloadNonce );
	if ( current.siteId !== siteId ) {
		return { siteId, byKey: { [ key ]: mounted } };
	}
	const surface = current.byKey[ key ];
	if ( ! surface ) {
		return { ...current, byKey: { ...current.byKey, [ key ]: mounted } };
	}
	return surface.path === path
		? current
		: { ...current, byKey: { ...current.byKey, [ key ]: { ...surface, path } } };
}

// A frame remounts, and so reloads, whenever its key changes.
export function getFrameKey( siteUrl: string, surface: PreviewSurfaceState ) {
	return `${ siteUrl }${ surface.path }#${ surface.reloadNonce }#${ surface.reloadCommandId }`;
}

export function getSafePath( path: unknown ) {
	return typeof path === 'string' && path.trim() ? path : '/';
}
