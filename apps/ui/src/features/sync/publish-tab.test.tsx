import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { SessionUIProvider } from '@/data/use-session-ui';
import { PublishButton, SiteDeliveryDialog } from '@/features/site-delivery';
import { createFakeConnector, makeSite, TEST_USER } from '@/test/fake-connector';
import { aiSettings } from '@/test/in-memory-connector';
import { renderWithProviders } from '@/test/render';
import type { RemoteSiteConnection, SyncSite } from '@/data/core';
import type { ProviderSites } from '@studio/providers';

const space: ProviderSites[ 'spacefast' ] = {
	id: 'spc_1',
	name: 'Local site',
	url: 'https://local-site.space.fast/',
	slug: 'local-site',
	teamId: 'team_1',
	teamName: 'My Team',
};

let siteCount = 0;

function setup( overrides: Parameters< typeof createFakeConnector >[ 1 ] = {} ) {
	const site = makeSite( { id: `spacefast-${ ++siteCount }`, name: 'Local site' } );
	const connections: RemoteSiteConnection< 'spacefast' >[] = [];
	const connector = createFakeConnector(
		{ sites: [ site ], user: TEST_USER },
		{
			getRemoteSites: async ( provider ) => ( provider === 'spacefast' ? connections : [] ),
			listAccountSites: async ( provider ) => ( provider === 'spacefast' ? connections : [] ),
			startProviderConnect: async () => ( {
				url: 'https://spacefast.com/device',
				code: 'ABCD-1234',
				handoff: { deviceCode: 'dev_1', interval: '1', expiresAt: '2030-01-01T00:00:00Z' },
			} ),
			createRemoteSite: async ( _provider, localSiteId ) => {
				connections.push( {
					...space,
					localSiteId,
					lastPushTimestamp: null,
					lastPullTimestamp: null,
				} );
				return space;
			},
			...overrides,
		}
	);
	renderWithProviders(
		<SessionUIProvider>
			<SiteDeliveryDialog site={ site } />
			<PublishButton site={ site } />
		</SessionUIProvider>,
		{ connector }
	);
	return { connector, site };
}

it( 'connects Spacefast, creates a Space named after the site, and publishes to it', async () => {
	const actions = userEvent.setup();
	const { connector, site } = setup();
	await actions.click( await screen.findByRole( 'button', { name: 'Publish…' } ) );
	await actions.click( await screen.findByRole( 'button', { name: /^Spacefast/ } ) );

	await actions.click( await screen.findByRole( 'button', { name: 'Connect Spacefast' } ) );
	await waitFor( () =>
		expect( connector.connectProvider ).toHaveBeenCalledWith( 'spacefast', 'sign-in', {
			deviceCode: 'dev_1',
			interval: '1',
			expiresAt: '2030-01-01T00:00:00Z',
		} )
	);
	expect( connector.openExternalUrl ).toHaveBeenCalledWith( 'https://spacefast.com/device' );

	await actions.click( await screen.findByRole( 'button', { name: 'New site' } ) );
	expect( connector.createRemoteSite ).toHaveBeenCalledWith( 'spacefast', site.id, 'Local site' );
	expect( await screen.findByText( 'My Team' ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'Pull changes' } ) ).not.toBeInTheDocument();

	await actions.click( screen.getByRole( 'button', { name: 'Publish changes' } ) );
	await screen.findByRole( 'button', { name: 'Cancel' } );
	expect( screen.queryByRole( 'radiogroup', { name: 'What to publish' } ) ).not.toBeInTheDocument();
	const publish = screen.getByRole( 'button', { name: 'Publish changes' } );
	await waitFor( () => expect( publish ).toBeEnabled() );
	await actions.click( publish );
	await waitFor( () =>
		expect( connector.pushSite ).toHaveBeenCalledWith( 'spacefast', site.id, 'spc_1', {
			optionsToSync: [ 'all' ],
		} )
	);
} );

it( 'publishes to WordPress.com directly where a static export can’t be made', async () => {
	const actions = userEvent.setup();
	setup( { capabilities: { nativeSites: false } } );
	await actions.click( await screen.findByRole( 'button', { name: 'Publish…' } ) );
	expect( await screen.findByRole( 'button', { name: 'New site…' } ) ).toBeVisible();
	expect( screen.queryByText( 'Where do you want to publish?' ) ).not.toBeInTheDocument();
} );

it( 'lists the sites published on every provider and publishes to another Space', async () => {
	const actions = userEvent.setup();
	const wpcomSite: SyncSite = {
		id: 42,
		localSiteId: 'local',
		name: 'Hosted site',
		url: 'https://example.com',
		isStaging: false,
		isPressable: false,
		syncSupport: 'syncable',
		lastPushTimestamp: null,
		lastPullTimestamp: null,
	};
	const second: ProviderSites[ 'spacefast' ] = {
		...space,
		id: 'spc_2',
		url: 'https://second.space.fast/',
	};
	const { connector, site } = setup( {
		getRemoteSites: async ( provider, localSiteId ) =>
			provider === 'wpcom'
				? [ { ...wpcomSite, localSiteId: localSiteId ?? '' } ]
				: [
						{
							...space,
							localSiteId: localSiteId ?? '',
							lastPushTimestamp: null,
							lastPullTimestamp: null,
						},
				  ],
		getAiSettings: async () => aiSettings( 'wpcom', [ 'wpcom', 'spacefast' ] ),
		createRemoteSite: async () => second,
	} );
	await actions.click( await screen.findByRole( 'button', { name: 'Publish…' } ) );
	expect(
		await screen.findByRole( 'button', { name: 'example.com' } )
	).toHaveAccessibleDescription( 'WordPress.com' );
	expect(
		screen.getByRole( 'button', { name: 'local-site.space.fast' } )
	).toHaveAccessibleDescription( 'Spacefast' );

	await actions.click( screen.getByRole( 'button', { name: 'Publish to another site…' } ) );
	await actions.click( await screen.findByRole( 'button', { name: /^Spacefast/ } ) );
	await actions.click( await screen.findByRole( 'button', { name: 'New site' } ) );
	expect( connector.createRemoteSite ).toHaveBeenCalledWith( 'spacefast', site.id, 'Local site' );
} );

it( 'offers to connect the provider again when it rejects its key', async () => {
	const actions = userEvent.setup();
	let connected = true;
	setup( {
		getRemoteSites: async ( provider, localSiteId ) =>
			provider === 'spacefast'
				? [
						{
							...space,
							localSiteId: localSiteId ?? '',
							lastPushTimestamp: null,
							lastPullTimestamp: null,
						},
				  ]
				: [],
		getAiSettings: async () =>
			aiSettings( 'wpcom', connected ? [ 'wpcom', 'spacefast' ] : [ 'wpcom' ] ),
		// The host forgets a key the provider rejects.
		listAccountSites: async () => {
			connected = false;
			throw new Error( 'Your Spacefast key no longer works. Connect Spacefast again.' );
		},
	} );
	await actions.click( await screen.findByRole( 'button', { name: 'Publish…' } ) );
	await actions.click( await screen.findByRole( 'button', { name: 'local-site.space.fast' } ) );

	expect( await screen.findByRole( 'button', { name: 'Connect Spacefast' } ) ).toBeVisible();
} );
