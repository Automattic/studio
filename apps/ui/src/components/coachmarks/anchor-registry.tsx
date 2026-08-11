import { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import type { CoachmarkAnchorId } from '@/data/onboarding/types';
import type { ReactNode } from 'react';

// A live map of coachmark-anchor id → registered DOM element(s), following the
// Sentry GuideAnchor pattern: components register their element on mount, so
// "is the target on screen yet?" is answered by the registry rather than by
// brittle document.querySelector polling. An element that is registered but
// laid out at zero size (e.g. a collapsed sidebar) counts as unavailable.

interface AnchorRegistry {
	register( id: CoachmarkAnchorId, element: HTMLElement ): () => void;
	getElement( id: CoachmarkAnchorId ): HTMLElement | null;
	subscribe( listener: () => void ): () => void;
}

const AnchorRegistryContext = createContext< AnchorRegistry | null >( null );

function isLaidOut( element: HTMLElement ): boolean {
	const rect = element.getBoundingClientRect();
	return rect.width > 4 && rect.height > 4;
}

export function CoachmarkAnchorProvider( { children }: { children: ReactNode } ) {
	const mapRef = useRef< Map< CoachmarkAnchorId, Set< HTMLElement > > >( new Map() );
	const listenersRef = useRef< Set< () => void > >( new Set() );

	const notify = useCallback( () => {
		for ( const listener of listenersRef.current ) {
			listener();
		}
	}, [] );

	const registry = useMemo< AnchorRegistry >(
		() => ( {
			register( id, element ) {
				let set = mapRef.current.get( id );
				if ( ! set ) {
					set = new Set();
					mapRef.current.set( id, set );
				}
				set.add( element );
				notify();
				return () => {
					const current = mapRef.current.get( id );
					if ( ! current ) {
						return;
					}
					current.delete( element );
					if ( current.size === 0 ) {
						mapRef.current.delete( id );
					}
					notify();
				};
			},
			getElement( id ) {
				const set = mapRef.current.get( id );
				if ( set ) {
					// Most recently registered laid-out element wins (Set keeps
					// insertion order), so a duplicate anchor mounted in a newer
					// panel supersedes a stale one.
					let match: HTMLElement | null = null;
					for ( const element of set ) {
						if ( isLaidOut( element ) ) {
							match = element;
						}
					}
					if ( match ) {
						return match;
					}
				}
				// Fallback for targets we can't wrap with the hook.
				const fallback = document.querySelector< HTMLElement >( `[data-tour-id="${ id }"]` );
				return fallback && isLaidOut( fallback ) ? fallback : null;
			},
			subscribe( listener ) {
				listenersRef.current.add( listener );
				return () => {
					listenersRef.current.delete( listener );
				};
			},
		} ),
		[ notify ]
	);

	return (
		<AnchorRegistryContext.Provider value={ registry }>{ children }</AnchorRegistryContext.Provider>
	);
}

export function useAnchorRegistry(): AnchorRegistry {
	const registry = useContext( AnchorRegistryContext );
	if ( ! registry ) {
		throw new Error( 'useAnchorRegistry must be used within a CoachmarkAnchorProvider' );
	}
	return registry;
}

/**
 * Returns a ref callback that registers its element as the given coachmark
 * anchor. Safe to use without a provider (returns a no-op), so instrumented
 * components render fine in isolation/tests.
 */
export function useTourAnchor(
	id: CoachmarkAnchorId,
	options?: { disabled?: boolean }
): ( element: HTMLElement | null ) => void {
	const registry = useContext( AnchorRegistryContext );
	const disabled = options?.disabled ?? false;
	const cleanupRef = useRef< ( () => void ) | null >( null );

	return useCallback(
		( element: HTMLElement | null ) => {
			if ( cleanupRef.current ) {
				cleanupRef.current();
				cleanupRef.current = null;
			}
			if ( registry && element && ! disabled ) {
				cleanupRef.current = registry.register( id, element );
			}
		},
		[ registry, id, disabled ]
	);
}
