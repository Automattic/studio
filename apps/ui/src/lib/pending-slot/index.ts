// One-shot hand-off between routes for values that can't ride in the URL.
export function createPendingSlot< T >() {
	let pending: T | null = null;
	const listeners = new Set< () => void >();
	const notify = () => listeners.forEach( ( listener ) => listener() );

	return {
		getSnapshot: () => pending,
		set( value: T ) {
			pending = value;
			notify();
		},
		clear( value: T ) {
			if ( pending !== value ) return;
			pending = null;
			notify();
		},
		subscribe( listener: () => void ) {
			listeners.add( listener );
			return () => listeners.delete( listener );
		},
	};
}
