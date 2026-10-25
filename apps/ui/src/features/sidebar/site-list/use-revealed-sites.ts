import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import { revealSite, toggleRevealedSite } from './sidebar-collections';

// Sites whose chats show under their row. Opening a site unfolds it (and,
// unless the user turned it off, folds the others); clicking the open site
// again folds it.
export function useRevealedSites( activeSiteKey: string | undefined, autoCollapse: boolean ) {
	const [ revealed, setRevealed ] = useState< ReadonlySet< string > >(
		() => new Set( activeSiteKey ? [ activeSiteKey ] : [] )
	);
	const revealActive = useEffectEvent( ( siteId: string ) =>
		setRevealed( ( current ) =>
			current.has( siteId ) ? current : revealSite( current, siteId, autoCollapse )
		)
	);
	useEffect( () => {
		if ( activeSiteKey ) {
			revealActive( activeSiteKey );
		}
	}, [ activeSiteKey ] );
	const collapseAll = useCallback( () => setRevealed( new Set() ), [] );
	const toggle = ( siteId: string ) =>
		setRevealed( ( current ) =>
			toggleRevealedSite( current, siteId, activeSiteKey, autoCollapse )
		);
	return { revealed, collapseAll, toggle };
}
