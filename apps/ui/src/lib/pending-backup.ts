let pendingBackup: File | null = null;
const listeners = new Set< () => void >();

export const pendingBackupSlot = {
	getSnapshot: () => pendingBackup,
	set( file: File ) {
		pendingBackup = file;
		listeners.forEach( ( listener ) => listener() );
	},
	clear( file: File ) {
		if ( pendingBackup !== file ) return;
		pendingBackup = null;
		listeners.forEach( ( listener ) => listener() );
	},
	subscribe( listener: () => void ) {
		listeners.add( listener );
		return () => listeners.delete( listener );
	},
};
