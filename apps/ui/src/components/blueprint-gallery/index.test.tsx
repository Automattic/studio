import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BlueprintGallery } from './index';
import type { Blueprint } from '@studio/common/lib/studio-blueprints-api';

const mocks = vi.hoisted( () => ( {
	isOffline: false,
	blueprints: {} as Record< string, unknown >,
	loadBlueprint: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-blueprints', () => ( {
	useBlueprints: () => mocks.blueprints,
} ) );

vi.mock( '@/hooks/use-offline', () => ( {
	useOffline: () => mocks.isOffline,
} ) );

vi.mock( '@/data/core', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@/data/core') >();
	return { ...actual, useConnector: () => ( {} ) };
} );

vi.mock( '@/lib/load-blueprint-file', () => ( {
	BLUEPRINT_FILE_ACCEPT: '.json,.zip',
	loadBlueprintFile: ( file: File ) => mocks.loadBlueprint( file ),
} ) );

function apiBlueprint( slug: string, title: string, excerpt = '' ): Blueprint {
	return { slug, title, excerpt, image: '', playground_url: '', blueprint: {} };
}

const QUICK_START = apiBlueprint( 'quick-start', 'Quick Start' );
const COOKBOOK = apiBlueprint( 'cookbook', 'Cookbook', 'Recipes and menus' );

describe( 'BlueprintGallery', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		mocks.isOffline = false;
		mocks.loadBlueprint.mockReset();
		mocks.blueprints = {
			data: [ QUICK_START, COOKBOOK ],
			isLoading: false,
			isError: false,
		};
	} );

	// Featured entries carry a Studio-facing display name, and that name is what
	// seeds the new site's name on the create form.
	it( 'hands a pick upward under its display name', () => {
		const onSelect = vi.fn();
		render( <BlueprintGallery onSelect={ onSelect } /> );

		fireEvent.click( screen.getByRole( 'button', { name: /WordPress\.com/ } ) );

		expect( onSelect ).toHaveBeenCalledWith(
			expect.objectContaining( { title: 'WordPress.com', excerpt: expect.any( String ) } )
		);
	} );

	it( 'filters Explore by excerpt while leaving Featured in place', () => {
		render( <BlueprintGallery onSelect={ vi.fn() } /> );
		const search = screen.getByRole( 'searchbox', { name: 'Search Blueprints' } );

		fireEvent.change( search, { target: { value: 'recipes' } } );
		expect( screen.getByRole( 'button', { name: /Cookbook/ } ) ).toBeInTheDocument();

		fireEvent.change( search, { target: { value: 'nothing here' } } );
		expect( screen.getByText( 'No Blueprints found.' ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: /WordPress\.com/ } ) ).toBeInTheDocument();
	} );

	it( 'hands an uploaded Blueprint upward like a curated pick', async () => {
		const uploaded = { title: 'My Blueprint' };
		mocks.loadBlueprint.mockResolvedValue( uploaded );
		const onSelect = vi.fn();
		const { container } = render( <BlueprintGallery onSelect={ onSelect } /> );
		const input = container.querySelector< HTMLInputElement >( 'input[type="file"]' );
		if ( ! input ) throw new Error( 'Blueprint input not found' );

		fireEvent.change( input, {
			target: { files: [ new File( [ '{}' ], 'my-blueprint.json' ) ] },
		} );

		await waitFor( () => expect( onSelect ).toHaveBeenCalledWith( uploaded ) );
	} );

	it( 'reports an unreadable Blueprint file instead of navigating on', async () => {
		mocks.loadBlueprint.mockRejectedValue( new Error( 'That file type is not supported.' ) );
		const onSelect = vi.fn();
		const { container } = render( <BlueprintGallery onSelect={ onSelect } /> );
		const input = container.querySelector< HTMLInputElement >( 'input[type="file"]' );
		if ( ! input ) throw new Error( 'Blueprint input not found' );

		fireEvent.change( input, { target: { files: [ new File( [ 'x' ], 'notes.txt' ) ] } } );

		expect( await screen.findByRole( 'alert' ) ).toHaveTextContent( 'not supported' );
		expect( onSelect ).not.toHaveBeenCalled();
	} );

	it( 'explains itself instead of showing an empty grid when offline', () => {
		mocks.isOffline = true;
		render( <BlueprintGallery onSelect={ vi.fn() } /> );

		expect( screen.getByText( /Blueprints could not be loaded/ ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: /Cookbook/ } ) ).not.toBeInTheDocument();
	} );
} );
