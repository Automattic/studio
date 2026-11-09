import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeConnector, TEST_USER } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { useAiProviderConnections } from './use-ai-settings';

function Connections() {
	const providers = useAiProviderConnections();
	return <output aria-label="Connected providers">{ providers.join( ', ' ) }</output>;
}

describe( 'AI provider connections', () => {
	it.each( [ false, true ] )(
		'uses live account auth over cached settings (connected=%s)',
		async ( connected ) => {
			const connector = createFakeConnector(
				{ user: null },
				{
					getAiSettings: async () => ( {
						provider: 'wpcom',
						connections: {
							wpcom: { connected, apiKeyPreview: null },
							'anthropic-api-key': { connected: true, apiKeyPreview: 'sk-…last' },
							chatgpt: { connected: false, apiKeyPreview: null },
						},
					} ),
				}
			);
			renderWithProviders( <Connections />, { connector } );
			const output = await screen.findByRole( 'status', { name: 'Connected providers' } );
			await waitFor( () => expect( output ).toHaveTextContent( /^anthropic-api-key$/ ) );
			act( () => {
				connector.state.user = TEST_USER;
				connector.emit( 'onAuthStateChanged' );
			} );
			await waitFor( () => expect( output ).toHaveTextContent( /^wpcom, anthropic-api-key$/ ) );
			act( () => {
				connector.state.user = null;
				connector.emit( 'onAuthStateChanged' );
			} );
			await waitFor( () => expect( output ).toHaveTextContent( /^anthropic-api-key$/ ) );
			expect( connector.getAiSettings ).toHaveBeenCalledTimes( 1 );
		}
	);
} );
