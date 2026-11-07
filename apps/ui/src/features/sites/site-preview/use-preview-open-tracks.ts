import { useCallback } from 'react';
import { useConnector } from '@/data/core';
import { getPreviewRealm, getRealmOpenEvent } from './address-bar';

export function usePreviewOpenTracks() {
	const connector = useConnector();
	return useCallback(
		( path: string, browser: 'internal' | 'external' = 'internal' ) => {
			const realm = getPreviewRealm( path );
			if ( browser === 'external' && ( realm === 'design' || realm === 'email' ) ) return;
			try {
				void connector
					.trackEvent( getRealmOpenEvent( realm ), { browser } )
					.catch( () => undefined );
			} catch {
				// Telemetry must not block opening the preview.
			}
		},
		[ connector ]
	);
}
