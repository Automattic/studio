import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { globalStylesQueryKey } from '@/data/queries/use-global-styles';
import { siteEmailsQueryKey } from '@/data/queries/use-site-emails';
import { getPathFromPreviewUrl, getPreviewRealm } from './address-bar';
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

/**
 * The preview's surfaces, where each one is pointed, and the commands sent to
 * them. `path` is the host's: it decides the realm on screen, and so which
 * surface is active.
 */
export function usePreviewSurfaces( {
	siteId,
	siteUrl,
	path,
	reloadNonce,
	onPathChange,
	active = true,
}: {
	siteId: string;
	siteUrl: string;
	path: string;
	reloadNonce: number;
	onPathChange?: ( path: string ) => void;
	active?: boolean;
} ) {
	const queryClient = useQueryClient();
	// Which realm the host is pointing the preview at. Derived from the path
	// rather than stored alongside it, so the parent stays the single source of
	// truth for where the preview is aimed.
	const activeRealm = getPreviewRealm( path );
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
			const nextPath = getPathFromPreviewUrl( url, siteUrl );
			if ( ! nextPath ) {
				return;
			}
			patchSurface( key, { path: nextPath } );
			// Only the visible surface speaks for the preview's location, so the
			// hidden one settling a redirect can't move the address bar. This is also
			// what lights up the WordPress segment when a front-end link points at
			// wp-admin: same surface, new path, new realm.
			if ( key === activeSurfaceKey && nextPath !== path ) {
				onPathChange?.( nextPath );
			}
		},
		[ activeSurfaceKey, onPathChange, patchSurface, path, siteUrl ]
	);
	// Commands are addressed to the surface on screen. Each has its own slot, so
	// the hidden one never sees a command it should have missed — and never
	// replays a stale one when it comes back into view.
	const sendSurfaceCommand = useCallback(
		( key: PreviewSurfaceKey, type: BrowserCommand[ 'type' ] ) => {
			if ( key === 'design' || key === 'email' ) {
				if ( type === 'reload' ) {
					void queryClient.invalidateQueries( {
						queryKey:
							key === 'design' ? globalStylesQueryKey( siteId ) : siteEmailsQueryKey( siteId ),
					} );
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
		if ( ! active || activeRealm === 'admin' ) {
			return;
		}
		if ( activeSurfaceKey === 'design' || activeSurfaceKey === 'email' ) {
			sendSurfaceCommand( activeSurfaceKey, 'reload' );
		} else {
			patchSurface( activeSurfaceKey, { reloadNonce } );
		}
	}, [ active, activeRealm, activeSurfaceKey, patchSurface, reloadNonce, sendSurfaceCommand ] );

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
	};
}
