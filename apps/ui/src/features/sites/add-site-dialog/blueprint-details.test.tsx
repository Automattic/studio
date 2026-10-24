import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pendingBlueprintSlot } from '@/lib/pending-blueprint';
import { BlueprintDetails } from './blueprint-details';
import type { Blueprint } from '@studio/common/lib/studio-blueprints-api';

const mocks = vi.hoisted( () => ( {
	navigate: vi.fn( async () => undefined ),
	openExternalUrl: vi.fn( async () => undefined ),
	createSite: vi.fn(),
	pinNewSite: vi.fn(),
	proposedPath: {} as Record< string, unknown >,
} ) );

vi.mock( '@tanstack/react-router', () => ( { useNavigate: () => mocks.navigate } ) );

vi.mock( '@/data/core', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@/data/core') >() ),
	useConnector: () => ( {
		openExternalUrl: mocks.openExternalUrl,
		generateNumberedSiteName: async ( name: string ) => `${ name } 2`,
	} ),
} ) );

vi.mock( '@/data/queries/use-create-site-helpers', () => ( {
	usePathValidator: () => ( { generateProposedPath: async () => mocks.proposedPath } ),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useSites: () => ( { data: [] } ),
	useCreateSite: () => ( { mutateAsync: mocks.createSite } ),
} ) );

vi.mock( './context', () => ( {
	useAddSite: () => ( {
		setProgress: vi.fn(),
		pinNewSite: mocks.pinNewSite,
		actions: document.body,
	} ),
} ) );

const BLOG: Blueprint = {
	slug: 'personal-blog-2',
	title: 'Personal Blog',
	excerpt: '',
	image: 'https://example.com/blog.jpg',
	playground_url: 'https://playground.wordpress.net/?blueprint-url=blog',
	blueprint: { steps: [] },
	bundle_url: 'https://example.com/bundle',
};

function renderDetails( blueprint = BLOG, onSetup = vi.fn() ) {
	render(
		<QueryClientProvider client={ new QueryClient() }>
			<BlueprintDetails blueprint={ blueprint } onSetup={ onSetup } />
		</QueryClientProvider>
	);
	return onSetup;
}

describe( 'BlueprintDetails', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		mocks.proposedPath = { path: '/Studio/personal-blog-2', isEmpty: true, isWordPress: false };
		mocks.createSite.mockResolvedValue( { id: 'site-1' } );
	} );

	it( 'previews the hosted demo', () => {
		renderDetails();
		fireEvent.click( screen.getByRole( 'button', { name: 'Preview in browser' } ) );
		expect( mocks.openExternalUrl ).toHaveBeenLastCalledWith(
			'https://substratademo.wordpress.com/'
		);
	} );

	it( 'falls back to the Playground for Blueprints without a demo', () => {
		renderDetails( { ...BLOG, slug: 'my-recipe' } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Preview in browser' } ) );
		expect( mocks.openExternalUrl ).toHaveBeenLastCalledWith( BLOG.playground_url );
	} );

	it( 'creates the site in a free folder and opens it', async () => {
		renderDetails();
		fireEvent.click( screen.getByRole( 'button', { name: 'Create site' } ) );

		await waitFor( () =>
			expect( mocks.navigate ).toHaveBeenCalledWith( {
				to: '/sites/$siteId/new',
				params: { siteId: 'site-1' },
			} )
		);
		expect( mocks.createSite ).toHaveBeenCalledWith(
			expect.objectContaining( {
				name: 'Personal Blog 2',
				path: '/Studio/personal-blog-2',
				blueprint: expect.objectContaining( { bundleUrl: BLOG.bundle_url } ),
			} )
		);
		expect( mocks.pinNewSite ).toHaveBeenCalledWith( 'site-1' );
	} );

	it( 'leaves the choice to the setup form when the folder is taken', async () => {
		mocks.proposedPath = { path: '/Studio/personal-blog-2', isEmpty: false, isWordPress: true };
		const onSetup = renderDetails();
		fireEvent.click( screen.getByRole( 'button', { name: 'Create site' } ) );

		await waitFor( () => expect( onSetup ).toHaveBeenCalled() );
		expect( mocks.createSite ).not.toHaveBeenCalled();
		const pending = pendingBlueprintSlot.getSnapshot();
		expect( pending ).toMatchObject( { slug: 'personal-blog-2', bundleUrl: BLOG.bundle_url } );
		pendingBlueprintSlot.clear( pending! );
	} );
} );
