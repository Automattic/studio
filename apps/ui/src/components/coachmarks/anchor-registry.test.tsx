import { render } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CoachmarkAnchorProvider, useAnchorRegistry, useTourAnchor } from './anchor-registry';
import type { CoachmarkAnchorId } from '@/data/onboarding/types';

interface AnchorRegistryHandle {
	getElement( id: CoachmarkAnchorId ): HTMLElement | null;
	subscribe( listener: () => void ): () => void;
}

// A visible element (getBoundingClientRect stubbed) registered under an id.
function Anchor( { id, size = 20 }: { id: 'composer'; size?: number } ) {
	const ref = useTourAnchor( id );
	return (
		<div
			ref={ ( element ) => {
				if ( element ) {
					element.getBoundingClientRect = () =>
						( {
							width: size,
							height: size,
							x: 0,
							y: 0,
							top: 0,
							left: 0,
							right: size,
							bottom: size,
							toJSON() {},
						} ) as DOMRect;
				}
				ref( element );
			} }
		/>
	);
}

function Capture( { onReady }: { onReady: ( registry: AnchorRegistryHandle ) => void } ) {
	const registry = useAnchorRegistry();
	useEffect( () => {
		onReady( registry as unknown as AnchorRegistryHandle );
	}, [ registry, onReady ] );
	return null;
}

describe( 'anchor registry', () => {
	it( 'resolves a registered, laid-out element', () => {
		let registry: AnchorRegistryHandle | null = null;
		render(
			<CoachmarkAnchorProvider>
				<Capture onReady={ ( value ) => ( registry = value ) } />
				<Anchor id="composer" />
			</CoachmarkAnchorProvider>
		);
		expect( registry!.getElement( 'composer' ) ).not.toBeNull();
	} );

	it( 'treats a zero-size (collapsed) element as unavailable', () => {
		let registry: AnchorRegistryHandle | null = null;
		render(
			<CoachmarkAnchorProvider>
				<Capture onReady={ ( value ) => ( registry = value ) } />
				<Anchor id="composer" size={ 0 } />
			</CoachmarkAnchorProvider>
		);
		expect( registry!.getElement( 'composer' ) ).toBeNull();
	} );

	it( 'unregisters on unmount and notifies subscribers', () => {
		let registry: AnchorRegistryHandle | null = null;
		const { rerender } = render(
			<CoachmarkAnchorProvider>
				<Capture onReady={ ( value ) => ( registry = value ) } />
				<Anchor id="composer" />
			</CoachmarkAnchorProvider>
		);
		const listener = vi.fn();
		const unsubscribe = registry!.subscribe( listener );
		rerender(
			<CoachmarkAnchorProvider>
				<Capture onReady={ ( value ) => ( registry = value ) } />
			</CoachmarkAnchorProvider>
		);
		expect( registry!.getElement( 'composer' ) ).toBeNull();
		expect( listener ).toHaveBeenCalled();
		unsubscribe();
	} );
} );
