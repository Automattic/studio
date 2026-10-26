interface OpenDialog {
	replaceable: boolean;
	close: () => void;
}

const openDialogs = new Set< OpenDialog >();
let pending: ( () => void ) | null = null;

function dropPending() {
	pending = null;
	document.removeEventListener( 'pointerdown', dropPending, true );
	document.removeEventListener( 'keydown', dropPending, true );
}

export function registerOpenDialog( dialog: OpenDialog ) {
	openDialogs.add( dialog );
	return () => {
		openDialogs.delete( dialog );
		if ( pending && openDialogs.size === 0 ) {
			const next = pending;
			dropPending();
			next();
		}
	};
}

/**
 * Closes the open dialogs another one may take the place of, then runs `next`
 * once they have. Returns false, doing nothing, while a dialog that keeps its
 * place is open. A replaceable dialog that stays open (unsaved changes, work in
 * progress) holds `next` back until the user's next click or key, then drops it.
 */
export function replaceOpenDialogs( next: () => void ): boolean {
	const dialogs = [ ...openDialogs ];
	if ( dialogs.some( ( dialog ) => ! dialog.replaceable ) ) {
		return false;
	}
	if ( dialogs.length === 0 ) {
		next();
		return true;
	}
	dropPending();
	pending = next;
	document.addEventListener( 'pointerdown', dropPending, true );
	document.addEventListener( 'keydown', dropPending, true );
	dialogs.forEach( ( dialog ) => dialog.close() );
	return true;
}
