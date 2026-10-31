import { DESIGN_SYSTEM_PREVIEW_PATH } from '@studio/agent/protocol/chat-artifacts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import { siteDesignQueryKey } from '@/data/queries/use-site-design';
import {
	DATABASE_HOME_PATH,
	getFrontendOrigin,
	getPreviewLocationFromUrl,
	getPreviewRealm,
	getRealmNavigationPath,
	getRealmOpenEvent,
	isFrontendAppPath,
	toFrontendAppPath,
	type PreviewRealm,
} from './address-bar';
import { EMPTY_BROWSER_STATE, type BrowserCommand } from './browser-state';
import {
	aimMountedSurface,
	createPreviewSurface,
	getSurfaceKey,
	patchMountedSurface,
	type MountedSurfaces,
	type PreviewSurfaceKey,
	type PreviewSurfaceState,
} from './surfaces';

// Where each realm segment lands before its per-realm memory has anything better.
function getDefaultRealmPaths( frontendUrl: string | undefined ): Record< PreviewRealm, string > {
	return {
		'frontend-app': frontendUrl ? toFrontendAppPath( '/', frontendUrl ) : '/',
		frontend: '/',
		admin: '/wp-admin/',
		database: DATABASE_HOME_PATH,
		design: DESIGN_SYSTEM_PREVIEW_PATH,
	};
}

/**
 * The preview's surfaces, where each one is pointed, and the commands sent to
 * them. `path` is the host's: it decides the realm on screen, and so which
 * surface is active.
 */
export function usePreviewSurfaces( {
	siteId,
	siteUrl,
	frontendUrl,
	path,
	reloadNonce,
	onPathChange,
}: {
	siteId: string;
	siteUrl: string;
	// A headless site's frontend origin.
	frontendUrl?: string;
	path: string;
	reloadNonce: number;
	onPathChange?: ( path: string ) => void;
} ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	// Which realm the host is pointing the preview at. Derived from the path
	// rather than stored alongside it, so the parent stays the single source of
	// truth for where the preview is aimed.
	const frontendOrigin = useMemo( () => getFrontendOrigin( frontendUrl ), [ frontendUrl ] );
	const activeRealm = getPreviewRealm( path, frontendOrigin );
	const activeSurfaceKey = getSurfaceKey( activeRealm );
	// Surfaces mounted so far. Once created a surface stays mounted and warm;
	// only the active one is visible.
	const [ surfaces, setSurfaces ] = useState< MountedSurfaces >( () => ( {
		siteId,
		byKey: { [ activeSurfaceKey ]: createPreviewSurface( path, reloadNonce ) },
	} ) );
	const activeSurface = surfaces.byKey[ activeSurfaceKey ];
	const browserState = activeSurface?.browser ?? EMPTY_BROWSER_STATE;
	const commandIdRef = useRef( 0 );
	const patchSurface = useCallback(
		( key: PreviewSurfaceKey, patch: Partial< PreviewSurfaceState > ) => {
			setSurfaces( ( current ) => patchMountedSurface( current, key, patch ) );
		},
		[]
	);
	const handleSurfaceNavigation = useCallback(
		( key: PreviewSurfaceKey, url: string ) => {
			const nextPath = getPreviewLocationFromUrl( url, siteUrl, frontendUrl );
			if ( ! nextPath ) {
				return;
			}
			// A link between a headless site's two origins leaves the surface on the
			// other origin's page, which only an absolute URL addresses from there.
			// The other surface takes over showing it.
			const crossedOrigin = ( key === 'app' ) !== isFrontendAppPath( nextPath, frontendOrigin );
			patchSurface( key, { path: crossedOrigin ? url : nextPath } );
			// Only the visible surface speaks for the preview's location, so the
			// hidden one settling a redirect can't move the address bar. This is also
			// what lights up the WordPress segment when a front-end link points at
			// wp-admin: same surface, new path, new realm.
			if ( key === activeSurfaceKey && nextPath !== path ) {
				onPathChange?.( nextPath );
			}
		},
		[ activeSurfaceKey, frontendOrigin, frontendUrl, onPathChange, patchSurface, path, siteUrl ]
	);
	// Commands are addressed to the surface on screen. Each has its own slot, so
	// the hidden one never sees a command it should have missed — and never
	// replays a stale one when it comes back into view.
	const sendSurfaceCommand = useCallback(
		( key: PreviewSurfaceKey, type: BrowserCommand[ 'type' ] ) => {
			if ( key === 'design' ) {
				if ( type === 'reload' ) {
					void queryClient.invalidateQueries( { queryKey: siteDesignQueryKey( siteId ) } );
				}
				return;
			}
			commandIdRef.current += 1;
			const id = commandIdRef.current;
			patchSurface( key, {
				browserCommand: { id, type },
				...( type === 'reload' ? { reloadCommandId: id } : {} ),
			} );
		},
		[ patchSurface, queryClient, siteId ]
	);
	const sendBrowserCommand = useCallback(
		( type: BrowserCommand[ 'type' ] ) => sendSurfaceCommand( activeSurfaceKey, type ),
		[ activeSurfaceKey, sendSurfaceCommand ]
	);
	const goToHistoryIndex = useCallback(
		( historyIndex: number ) => {
			commandIdRef.current += 1;
			patchSurface( activeSurfaceKey, {
				browserCommand: {
					id: commandIdRef.current,
					type: 'go-to-history',
					historyIndex,
				},
			} );
		},
		[ activeSurfaceKey, patchSurface ]
	);

	useEffect( () => {
		setSurfaces( ( current ) =>
			aimMountedSurface( current, siteId, activeSurfaceKey, path, reloadNonce )
		);
	}, [ activeSurfaceKey, reloadNonce, path, siteId ] );

	// A host-driven reload targets what's on screen. Tracked against the last
	// seen nonce so a switch doesn't replay it on the surface arrived at. WP
	// Admin is left alone: the person may be working there, with unsaved edits
	// in the editor, and a reload would interrupt them.
	const lastHostReloadNonceRef = useRef( reloadNonce );
	useEffect( () => {
		if ( lastHostReloadNonceRef.current === reloadNonce ) {
			return;
		}
		lastHostReloadNonceRef.current = reloadNonce;
		if ( activeRealm === 'admin' ) {
			return;
		}
		if ( activeSurfaceKey === 'design' ) {
			sendSurfaceCommand( 'design', 'reload' );
		} else {
			patchSurface( activeSurfaceKey, { reloadNonce } );
		}
	}, [ activeRealm, activeSurfaceKey, patchSurface, reloadNonce, sendSurfaceCommand ] );

	// Where each realm was last seen, so flipping to WP Admin and back returns
	// to the exact front-end page rather than the site root.
	// Filled by the effect below, so the defaults aren't rebuilt on every render.
	const lastRealmPathsRef = useRef< Record< PreviewRealm, string > | null >( null );
	useEffect( () => {
		lastRealmPathsRef.current = getDefaultRealmPaths( frontendUrl );
	}, [ siteId, frontendUrl ] );
	useEffect( () => {
		// Auto-login is a transient hop, not a place to return to.
		if ( path.startsWith( '/studio-auto-login' ) ) {
			return;
		}
		lastRealmPathsRef.current ??= getDefaultRealmPaths( frontendUrl );
		lastRealmPathsRef.current[ getPreviewRealm( path, frontendOrigin ) ] = path;
	}, [ path, frontendOrigin, frontendUrl ] );

	// Realm segments (front end / WP Admin / database). Moving between the front
	// end and WP Admin is a navigation inside the shared site surface, so they
	// keep one history and one login; admin targets go through the site's
	// /studio-auto-login endpoint so they never land on the login form. Moving to
	// another surface reloads it, so it shows what changed while it was hidden.
	const switchRealm = useCallback(
		( realm: PreviewRealm ) => {
			if ( activeRealm === realm ) {
				return;
			}
			void connector.trackEvent( getRealmOpenEvent( realm ), { browser: 'internal' } );
			lastRealmPathsRef.current ??= getDefaultRealmPaths( frontendUrl );
			const target = lastRealmPathsRef.current[ realm ];
			const key = getSurfaceKey( realm );
			if ( surfaces.byKey[ key ]?.path === target ) {
				sendSurfaceCommand( key, 'reload' );
				onPathChange?.( target );
				return;
			}
			onPathChange?.( getRealmNavigationPath( target, siteUrl ) );
		},
		[ activeRealm, connector, frontendUrl, onPathChange, sendSurfaceCommand, siteUrl, surfaces ]
	);

	return {
		surfaces: surfaces.byKey,
		activeRealm,
		activeSurfaceKey,
		activeSurface,
		browserState,
		patchSurface,
		handleSurfaceNavigation,
		sendSurfaceCommand,
		sendBrowserCommand,
		goToHistoryIndex,
		switchRealm,
	};
}
