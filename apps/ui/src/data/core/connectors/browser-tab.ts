// What the connectors that run in a browser tab share in place of the desktop's
// application menu and Save-As dialog.
import { isShortcut } from '@/lib/keyboard';
import type { Connector } from '../types';

function onMenuShortcut( listener: () => void, key: string, modifier?: 'shift' ) {
	const onKeyDown = ( event: KeyboardEvent ) => {
		if ( ! event.defaultPrevented && ! event.repeat && isShortcut( event, key, modifier ) ) {
			event.preventDefault();
			listener();
		}
	};
	document.addEventListener( 'keydown', onKeyDown );
	return () => document.removeEventListener( 'keydown', onKeyDown );
}

export const menuShortcuts: Pick<
	Connector,
	'onTogglePanel' | 'onToggleSidebar' | 'onAddSite' | 'onNewChat' | 'onOpenSettings'
> = {
	onTogglePanel: ( listener ) => onMenuShortcut( listener, 'b', 'shift' ),
	onToggleSidebar: ( listener ) => onMenuShortcut( listener, 'b' ),
	onAddSite: ( listener ) => onMenuShortcut( listener, 'n' ),
	onNewChat: ( listener ) => onMenuShortcut( listener, 'n', 'shift' ),
	onOpenSettings: ( listener ) => onMenuShortcut( () => listener( {} ), ',' ),
};

export function download( data: BlobPart, filename: string, type?: string ): string {
	const url = URL.createObjectURL( new Blob( [ data ], { type } ) );
	const anchor = document.createElement( 'a' );
	anchor.href = url;
	anchor.download = filename;
	document.body.appendChild( anchor );
	anchor.click();
	anchor.remove();
	setTimeout( () => URL.revokeObjectURL( url ), 10_000 );
	return filename;
}
