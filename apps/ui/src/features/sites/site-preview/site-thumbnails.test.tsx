import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { siteThumbnailQueryKey } from '@/data/queries/use-site-thumbnail';
import { SessionUIProvider } from '@/data/use-session-ui';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { createTestQueryClient, renderWithProviders } from '@/test/render';
import { SitePreview } from './index';

afterEach( () => vi.unstubAllGlobals() );

it( 'replaces an empty cached preview with the capture', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn( async () => new Response() )
	);
	const connector = createFakeConnector(
		{},
		{ captureSitePreview: async () => 'data:image/png;base64,new' }
	);
	const queryClient = createTestQueryClient();
	queryClient.setQueryData( siteThumbnailQueryKey( 'one' ), null );
	renderWithProviders(
		<SessionUIProvider>
			<SitePreview site={ makeSite( { id: 'one', running: true } ) } path="/" reloadNonce={ 0 } />
		</SessionUIProvider>,
		{ connector, queryClient }
	);
	const frame = await screen.findByTitle( 'My site' );
	for ( const [ key, value ] of Object.entries( { clientWidth: 800, clientHeight: 600 } ) ) {
		Object.defineProperty( frame.closest( 'div[class*="previewViewport"]' ), key, { value } );
	}
	fireEvent.load( frame );
	await waitFor( () =>
		expect( queryClient.getQueryData( siteThumbnailQueryKey( 'one' ) ) ).toBe(
			'data:image/png;base64,new'
		)
	);
	expect( connector.getSiteThumbnail ).not.toHaveBeenCalled();
} );
