let isOpen = false;
const listeners = new Set< () => void >();

function emit() {
	listeners.forEach( ( listener ) => listener() );
}

export const wapuuWorldSlot = {
	getSnapshot: () => isOpen,
	open() {
		if ( isOpen ) return;
		isOpen = true;
		emit();
	},
	close() {
		if ( ! isOpen ) return;
		isOpen = false;
		emit();
	},
	subscribe( listener: () => void ) {
		listeners.add( listener );
		return () => listeners.delete( listener );
	},
};
