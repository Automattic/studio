import { useEffect, useMemo } from 'react';
import { isDialogOpen } from '@/lib/keyboard';
import {
	getBrowserShortcutCommand,
	getBrowserShortcutDescriptor,
	getNavigationShortcutDescriptor,
} from './browser-shortcuts';
import type { BrowserShortcutCommand } from '@studio/common/ai/inspector/page-script';

// Browser shortcuts (⌘R / ⌘[ / ⌘] / ⌘←/⌘→) pressed anywhere in the host
// document but a dialog, the composer included. Shortcuts pressed inside the
// guest page are forwarded by the inspector script through the console
// bridge instead.
export function useBrowserShortcuts(
	enabled: boolean,
	onCommand: ( command: BrowserShortcutCommand ) => void
) {
	useEffect( () => {
		if ( ! enabled ) {
			return;
		}
		const handleKeyDown = ( event: globalThis.KeyboardEvent ) => {
			const command = getBrowserShortcutCommand( event );
			if ( ! command || isDialogOpen() ) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			onCommand( command );
		};

		document.addEventListener( 'keydown', handleKeyDown, { capture: true } );
		return () => document.removeEventListener( 'keydown', handleKeyDown, { capture: true } );
	}, [ enabled, onCommand ] );

	return useMemo(
		() => ( {
			back: getNavigationShortcutDescriptor( 'back' ),
			forward: getNavigationShortcutDescriptor( 'forward' ),
			reload: getBrowserShortcutDescriptor( 'r' ),
		} ),
		[]
	);
}
