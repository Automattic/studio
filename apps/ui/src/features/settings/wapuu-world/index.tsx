import { useSyncExternalStore } from 'react';
import { wapuuWorldSlot } from '@/lib/wapuu-world';
import { useKonamiCode } from './use-konami-code';
import { WapuuWorldGame } from './wapuu-world-game';

/**
 * Global mount for the Wapuu World easter egg. Listens for the Konami code and,
 * once entered, renders the game as a full-screen overlay. Rendered as a sibling
 * of the router outlet so it's available on every route.
 */
export function WapuuWorldMount() {
	const isOpen = useSyncExternalStore( wapuuWorldSlot.subscribe, wapuuWorldSlot.getSnapshot );

	useKonamiCode( wapuuWorldSlot.open );

	if ( ! isOpen ) return null;

	return <WapuuWorldGame onClose={ wapuuWorldSlot.close } />;
}
