import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BlueprintGallery } from './blueprint-gallery';
import type { Blueprint } from '@studio/common/lib/studio-blueprints-api';

const mocks = vi.hoisted( () => ( {
	isOffline: false,
	blueprints: {} as Record< string, unknown >,
} ) );

vi.mock( '@/data/queries/use-blueprints', () => ( {
	useBlueprints: () => mocks.blueprints,
} ) );

vi.mock( '@/hooks/use-offline', () => ( {
	useOffline: () => mocks.isOffline,
} ) );

function apiBlueprint( slug: string, title: string ): Blueprint {
	return { slug, title, excerpt: '', image: '', playground_url: '', blueprint: {} };
}

const BLOG = apiBlueprint( 'personal-blog-2', 'Personal Blog' );
const STORE = apiBlueprint( 'woo-shop', 'Commerce' );

describe( 'BlueprintGallery', () => {
	beforeEach( () => {
		mocks.isOffline = false;
		mocks.blueprints = { data: [ BLOG, STORE ], isLoading: false, isError: false };
	} );

	it( 'starts with Blank site, then views a Blueprint', () => {
		const onBlank = vi.fn();
		const onView = vi.fn();
		render( <BlueprintGallery onBlank={ onBlank } onView={ onView } /> );

		const cards = screen.getAllByRole( 'button' );
		expect( cards.map( ( card ) => card.getAttribute( 'aria-label' ) ) ).toEqual( [
			'Start with Blank site',
			'View Personal Blog',
			'View Commerce',
		] );
		fireEvent.click( cards[ 0 ] );
		fireEvent.click( cards[ 2 ] );

		expect( onBlank ).toHaveBeenCalled();
		expect( onView ).toHaveBeenCalledWith( STORE );
	} );

	it( 'shows only the Blueprints for a use case', () => {
		render( <BlueprintGallery useCase="store" onBlank={ vi.fn() } onView={ vi.fn() } /> );

		expect( screen.getAllByRole( 'button' ).map( ( card ) => card.textContent ) ).toEqual( [
			'View blueprintCommerce',
		] );
	} );

	it( 'keeps Blank site when the Blueprints cannot load', () => {
		mocks.isOffline = true;
		mocks.blueprints = { data: undefined, isLoading: false, isError: true };
		render( <BlueprintGallery onBlank={ vi.fn() } onView={ vi.fn() } /> );

		expect( screen.getByText( /Blueprints could not be loaded/ ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Start with Blank site' } ) ).toBeVisible();
	} );
} );
