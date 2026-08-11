/**
 * A one-slot handoff between a producer outside a route's own UI (a deep
 * link, the onboarding home screen) and the route that consumes the value.
 * The producer `set`s the value and navigates; the route adopts it on
 * arrival and `clear`s the slot.
 *
 * `subscribe` notifies on every set/clear so routes can read the slot via
 * `useSyncExternalStore` and react to a new value arriving while already
 * mounted (e.g. a second deep link mid-configure). Adoption and clearing
 * stay split (rather than an atomic take) so React StrictMode's
 * double-invoked effects can't consume the value on the first pass and
 * bounce the user back on the second.
 */
export interface PendingSlot< T > {
	set( value: T ): void;
	peek(): T | null;
	/**
	 * Empties the slot. Pass the value you adopted to make the clear
	 * identity-checked: the slot is only emptied if it still holds that exact
	 * value, so a newer value that arrived in the meantime survives.
	 */
	clear( expected?: T ): void;
	subscribe( listener: () => void ): () => void;
}

export function createPendingSlot< T >(): PendingSlot< T > {
	let value: T | null = null;
	const listeners = new Set< () => void >();
	const notify = () => {
		for ( const listener of [ ...listeners ] ) {
			listener();
		}
	};
	return {
		set( next: T ) {
			value = next;
			notify();
		},
		peek: () => value,
		clear( expected?: T ) {
			if ( value === null ) {
				return;
			}
			if ( expected !== undefined && value !== expected ) {
				return;
			}
			value = null;
			notify();
		},
		subscribe( listener: () => void ) {
			listeners.add( listener );
			return () => {
				listeners.delete( listener );
			};
		},
	};
}
