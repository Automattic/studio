import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { getVisibleToasts } from '@/data/app-messages';
import { buildPublishCheckoutUrl } from '@/data/core/connectors/publish-checkout-url';
import { remoteSitesQueryKey } from '@/data/queries/use-remote-sites';
import { SNAPSHOT_USAGE_QUERY_KEY } from '@/data/queries/user-scoped-query-keys';
import { requestHeaderPanel } from '@/data/use-open-header-panel';
import { createFakeConnector, makeSite, TEST_USER, aiSettings } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { PublishButton } from './publish-button';
import type { Snapshot } from '@/data/core';
import type { ConnectorOverrides } from '@/test/in-memory-connector';
const site = makeSite( { id: 'provider-panel' } );
const live = {
	id: 42,
	localSiteId: site.id,
	name: 'Live',
	url: 'https://lente.blog',
	isStaging: false,
	isPressable: false,
	syncSupport: 'syncable' as const,
	launchStatus: 'launched',
	lastPushTimestamp: new Date().toISOString(),
	lastPullTimestamp: null,
};
const space = {
	id: 'spc_1',
	name: 'Static',
	url: 'https://lente.space.fast',
	slug: 'lente',
	teamId: 'team',
	teamSlug: 'studio',
	localSiteId: site.id,
	lastPushTimestamp: new Date().toISOString(),
	lastPullTimestamp: null,
};
const preview: Snapshot = {
	atomicSiteId: 123,
	localSiteId: site.id,
	userId: TEST_USER.id,
	date: Date.now(),
	url: 'lente-preview.wpcomstaging.com',
	shareUrl: 'https://lente-preview.wpcomstaging.com/?share=secret',
};
let sequence = 0;
beforeEach( () => {
	localStorage.clear();
	site.id = `provider-panel-${ ++sequence }`;
	live.localSiteId = site.id;
	space.localSiteId = site.id;
	preview.localSiteId = site.id;
} );
function setup( overrides: ConnectorOverrides = {} ) {
	const connector = createFakeConnector(
		{ sites: [ site ], user: TEST_USER },
		{
			getAiSettings: async () => aiSettings( 'wpcom', [ 'wpcom', 'spacefast' ] ),
			getPublishCheckoutUrl: buildPublishCheckoutUrl,
			getSnapshots: async () => [ preview ],
			getSnapshotUsage: async () => ( { siteCount: 1, siteLimit: 5, siteCreationBlocked: false } ),
			getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [ space ] ),
			listAccountSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [ space ] ),
			getSiteVisibility: async ( provider, id ) => ( {
				url:
					provider === 'spacefast'
						? id === 'spc_2'
							? 'https://second.space.fast'
							: space.url
						: live.url,
				launchStatus: 'launched',
				visibility: 'public',
			} ),
			getSitePublishStatus: async ( _local, _remote, provider ) => ( {
				localChanged: provider === 'spacefast',
			} ),
			getPreviewStatus: async () => ( {
				localSiteId: site.id,
				localChanged: false,
				previewChanged: false,
			} ),
			listLocalFileTree: async () =>
				[ 'plugins', 'themes', 'uploads' ].map( ( name ) => ( {
					name,
					path: `wp-content/${ name }`,
					isDirectory: true,
					children: [],
				} ) ),
			...overrides,
		}
	);
	return { ...renderWithProviders( <PublishButton site={ site } />, { connector } ), connector };
}
async function open() {
	fireEvent.click( await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } ) );
	return screen.findByRole( 'dialog', { name: /^(Share|Publish)$/ } );
}
async function mainMenu() {
	fireEvent.click( await screen.findByRole( 'button', { name: 'More options' } ) );
	return screen.findByRole( 'menu' );
}
async function switchTo( hostname: string ) {
	fireEvent.click( await screen.findByRole( 'button', { name: 'Choose destination' } ) );
	const menu = await screen.findByRole( 'menu', { name: 'Destinations' } );
	fireEvent.click( within( menu ).getByRole( 'menuitemradio', { name: hostname } ) );
}
it( 'renders the selected provider capabilities and isolates its change dot', async () => {
	const { user, connector } = setup();
	await open();
	expect( await screen.findByRole( 'button', { name: 'Who can view' } ) ).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'What to publish' } ) ).toBeVisible();
	expect( screen.queryByText( 'Some features may not work' ) ).not.toBeInTheDocument();
	expect( screen.queryByLabelText( 'Local changes' ) ).not.toBeInTheDocument();
	await user.click( screen.getByRole( 'button', { name: 'More options' } ) );
	expect(
		( await screen.findAllByRole( 'menuitem' ) ).map( ( item ) => item.textContent?.trim() )
	).toEqual( [
		'New preview',
		'WordPress admin',
		'Domains',
		'Backups',
		'Pull from live site',
		'Connect existing site',
		'Manage sharing',
		'Disconnect site',
	] );
	await user.click( await screen.findByRole( 'menuitem', { name: 'Pull from live site' } ) );
	const confirmation = await screen.findByRole( 'alertdialog', { name: 'Pull from live site?' } );
	expect( confirmation ).toHaveTextContent(
		"Any changes you haven't pushed in those parts will be lost."
	);
	expect( connector.pullSite ).not.toHaveBeenCalled();
	expect( within( confirmation ).getByRole( 'combobox', { name: 'What to pull' } ) ).toBeVisible();
	await user.click( within( confirmation ).getByRole( 'button', { name: 'Cancel' } ) );
	await waitFor( () => expect( confirmation ).not.toBeInTheDocument() );
	const panel = await screen.findByRole( 'dialog', { name: 'Publish' } );
	await user.click( within( panel ).getByRole( 'button', { name: 'Choose destination' } ) );
	await user.click( await screen.findByRole( 'menuitemradio', { name: 'lente.space.fast' } ) );
	expect( await screen.findByRole( 'button', { name: 'lente.space.fast' } ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'lente.blog' } ) ).not.toBeInTheDocument();
	expect( screen.queryByText( 'Some features may not work' ) ).not.toBeInTheDocument();
	expect( screen.queryByText( 'Like forms, comments, and search' ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'button', { name: 'Who can view' } ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'What to publish' } ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'button', { name: 'Publish changes' } ) ).toBeVisible();
	expect( screen.getByLabelText( 'Local changes' ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'Copy link' } ) ).not.toBeInTheDocument();
	await user.click( screen.getByRole( 'button', { name: 'More options' } ) );
	expect(
		( await screen.findAllByRole( 'menuitem' ) ).map( ( item ) => item.textContent?.trim() )
	).toEqual( [
		'Open on Spacefast',
		'Connect existing site',
		'Manage sharing',
		'Disconnect site',
	] );
	await user.click( screen.getByRole( 'menuitem', { name: 'Open on Spacefast' } ) );
	expect( connector.openExternalUrl ).toHaveBeenCalledExactlyOnceWith(
		'https://my.spacefast.com/'
	);
} );

it( 'keeps actions in the panel menu for a single connected site', async () => {
	setup( {
		getAuthUser: async () => null,
		getAiSettings: async () => aiSettings( 'wpcom', [ 'spacefast' ] ),
		getRemoteSites: async ( provider ) => ( provider === 'spacefast' ? [ space ] : [] ),
	} );
	const panel = await open();
	expect(
		within( panel ).queryByRole( 'button', { name: 'Choose destination' } )
	).not.toBeInTheDocument();
	expect( within( panel ).getByRole( 'button', { name: 'lente.space.fast' } ) ).toBeVisible();
	const menu = await mainMenu();
	expect(
		within( menu )
			.getAllByRole( 'menuitem' )
			.map( ( item ) => item.textContent?.trim() )
	).toEqual( [
		'Open on Spacefast',
		'Connect existing site',
		'Manage sharing',
		'Disconnect site',
	] );
} );

it( 'can create a new preview from the destination selector in Publish', async () => {
	const { user, connector } = setup( {
		publishPreviewSite: () => new Promise( () => {} ),
	} );
	const panel = await open();
	expect( within( panel ).queryByRole( 'heading', { name: 'Previews' } ) ).not.toBeInTheDocument();
	expect(
		within( panel ).queryByRole( 'button', { name: 'New preview' } )
	).not.toBeInTheDocument();
	await user.click( screen.getByRole( 'button', { name: 'Choose destination' } ) );
	await user.click( await screen.findByRole( 'menuitem', { name: 'New preview' } ) );
	await waitFor( () =>
		expect( connector.publishPreviewSite ).toHaveBeenCalledExactlyOnceWith(
			site.id,
			undefined,
			undefined
		)
	);
} );

it( 'keeps the Share menu focused on previews when multiple providers are connected', async () => {
	const { user } = setup();
	await open();
	await switchTo( 'lente-preview.wpcomstaging.com' );
	const panel = await screen.findByRole( 'dialog', { name: 'Share' } );
	await user.click( within( panel ).getByRole( 'button', { name: 'More options' } ) );
	expect(
		( await screen.findAllByRole( 'menuitem' ) ).map( ( item ) => item.textContent?.trim() )
	).toEqual( [
		'New preview',
		'Rename',
		'Update preview',
		'Pull from preview',
		'WordPress admin',
		'Connect existing site',
		'Manage sharing',
		'Delete preview',
	] );
} );

it.each( [
	{ hostname: 'lente.blog', rowName: 'lente.blog', url: live.url },
	{ hostname: 'lente.space.fast', rowName: 'lente.space.fast', url: space.url },
	{
		hostname: 'lente-preview.wpcomstaging.com',
		rowName: 'Open preview: lente-preview.wpcomstaging.com',
		url: preview.shareUrl,
	},
] )( 'shares the URL row and panel actions for $hostname', async ( { hostname, rowName, url } ) => {
	const { user, connector } = setup();
	await open();
	await switchTo( hostname );
	const row = await screen.findByRole( 'button', { name: rowName } );
	const items = ( menu: HTMLElement ) =>
		within( menu )
			.getAllByRole( 'menuitem' )
			.map( ( item ) => item.textContent?.trim() );
	await user.click( screen.getByRole( 'button', { name: 'More options' } ) );
	const ellipsis = await screen.findByRole( 'menu' );
	const expected = items( ellipsis ).filter(
		( label ) =>
			! [ 'New preview', 'Manage sharing', 'Connect existing site' ].includes( label ?? '' )
	);
	await user.keyboard( '{Escape}' );
	await waitFor( () => expect( ellipsis ).not.toBeInTheDocument() );
	row.focus();
	await user.keyboard( '{Shift>}{F10}{/Shift}' );
	const context = await screen.findByRole( 'menu', { name: 'Destination actions' } );
	if ( hostname === 'lente-preview.wpcomstaging.com' ) {
		expect( items( context ) ).toEqual( expected );
		expect( items( context ) ).toEqual( [
			'Rename',
			'Update preview',
			'Pull from preview',
			'WordPress admin',
			'Delete preview',
		] );
		expect( within( context ).getAllByRole( 'separator' ) ).toHaveLength( 1 );
		return;
	}
	expect( items( context ) ).toEqual( [ 'Copy link', ...expected ] );
	await user.click( within( context ).getByRole( 'menuitem', { name: /^Copy (preview )?link$/ } ) );
	expect( connector.copyText ).toHaveBeenCalledExactlyOnceWith( url );
	expect( connector.openExternalUrl ).not.toHaveBeenCalled();
} );

it( 'reports a failed live push as a notification while keeping the panel open', async () => {
	setup( {
		pushSite: async () => {
			throw new Error( 'Upload failed' );
		},
	} );
	await open();
	await switchTo( 'lente.space.fast' );
	const publish = await screen.findByRole( 'button', { name: 'Publish changes' } );
	await waitFor( () => expect( publish ).toBeEnabled() );
	fireEvent.click( publish );
	await waitFor(
		() =>
			expect( getVisibleToasts().filter( ( notice ) => notice.intent === 'error' ) ).toMatchObject(
				[ { title: 'Publishing didn’t finish' } ]
			),
		{ timeout: 3000 }
	);
	const panel = screen.getByRole( 'dialog', { name: 'Publish' } );
	expect( panel ).toBeVisible();
	expect( within( panel ).queryByRole( 'alert' ) ).not.toBeInTheDocument();
	expect( within( panel ).getByRole( 'button', { name: 'Publish changes' } ) ).toBeEnabled();
} );
it( 'switches the header and actions back to Share for a preview even with live sites', async () => {
	setup();
	await open();
	await switchTo( 'lente-preview.wpcomstaging.com' );
	expect( await screen.findByRole( 'button', { name: 'Share…' } ) ).toBeVisible();
	expect( screen.getByRole( 'heading', { name: 'Share' } ) ).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'Copy link' } ) ).toBeVisible();
	expect( screen.queryByLabelText( 'Local changes' ) ).not.toBeInTheDocument();
} );
it( 'groups connected sites and previews in a single destination switcher', async () => {
	const { connector, user } = setup( {
		getRemoteSites: async ( provider ) =>
			provider === 'wpcom' ? [ live ] : [ { ...space, lastPushTimestamp: null } ],
		listAccountSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [] ),
	} );
	const panel = await open();
	const publish = screen.getByRole( 'button', { name: 'Publish…' } );
	expect( within( publish ).queryByLabelText( 'Local changes' ) ).not.toBeInTheDocument();
	expect( within( panel ).getByRole( 'button', { name: 'lente.blog' } ) ).toBeVisible();
	expect(
		within( panel ).queryByRole( 'button', { name: 'lente.space.fast' } )
	).not.toBeInTheDocument();
	expect(
		within( panel ).queryByRole( 'button', { name: /^Open preview:/ } )
	).not.toBeInTheDocument();

	const switcher = within( panel ).getByRole( 'button', { name: 'Choose destination' } );
	await user.click( switcher );
	const menu = await screen.findByRole( 'menu', { name: 'Destinations' } );
	const sites = within( menu ).getByRole( 'group', { name: 'Connected sites' } );
	const previews = within( menu ).getByRole( 'group', { name: 'Previews' } );
	expect( within( sites ).getByRole( 'menuitemradio', { name: 'lente.blog' } ) ).toBeChecked();
	expect(
		within( previews ).getByRole( 'menuitemradio', { name: 'lente-preview.wpcomstaging.com' } )
	).not.toBeChecked();
	const staticSite = within( sites ).getByRole( 'menuitemradio', { name: 'lente.space.fast' } );
	expect( staticSite ).toHaveTextContent( 'Not published yet' );
	await user.click( staticSite );
	expect( await within( publish ).findByLabelText( 'Local changes' ) ).toBeVisible();
	expect( within( panel ).getByRole( 'button', { name: 'Publish' } ) ).toBeVisible();
	expect( within( panel ).getByRole( 'button', { name: 'lente.space.fast' } ) ).toBeVisible();
	expect( connector.createRemoteSite ).not.toHaveBeenCalled();
	expect( connector.pushSite ).not.toHaveBeenCalled();
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
} );

it( 'switches between two Spacefast sites by keyboard and restores focus', async () => {
	const second = {
		...space,
		id: 'spc_2',
		slug: 'second',
		url: 'https://second.space.fast',
		lastPushTimestamp: null,
	};
	const { connector, user } = setup( {
		getSnapshots: async () => [],
		getRemoteSites: async ( provider ) => ( provider === 'spacefast' ? [ space, second ] : [] ),
		getSitePublishStatus: async () => ( { localChanged: false } ),
	} );
	const panel = await open();
	expect( within( panel ).getByRole( 'button', { name: 'lente.space.fast' } ) ).toBeVisible();
	expect( await within( panel ).findByRole( 'button', { name: 'Copy link' } ) ).toBeEnabled();
	const switcher = within( panel ).getByRole( 'button', { name: 'Choose destination' } );
	switcher.focus();
	await user.keyboard( '{ArrowDown}' );
	const menu = await screen.findByRole( 'menu', { name: 'Destinations' } );
	const firstOption = within( menu ).getByRole( 'menuitemradio', { name: 'lente.space.fast' } );
	expect( firstOption ).toBeChecked();
	await waitFor( () => expect( firstOption ).toHaveFocus() );
	expect(
		within( menu ).queryByRole( 'group', { name: 'Connected sites' } )
	).not.toBeInTheDocument();
	await user.keyboard( '{End}{ArrowUp}' );
	await waitFor( () =>
		expect(
			within( menu ).getByRole( 'menuitemradio', { name: 'second.space.fast' } )
		).toHaveFocus()
	);
	await user.keyboard( '{Enter}' );
	await waitFor( () => expect( menu ).not.toBeInTheDocument() );
	expect( switcher ).toHaveFocus();
	expect( within( panel ).getByRole( 'button', { name: 'second.space.fast' } ) ).toBeVisible();
	expect( within( panel ).getByText( 'Not published yet' ) ).toBeVisible();
	expect( within( panel ).getByRole( 'button', { name: 'Publish' } ) ).toBeEnabled();
	const row = screen.getByRole( 'button', { name: 'second.space.fast' } );
	row.focus();
	await user.keyboard( '{Shift>}{F10}{/Shift}' );
	await user.click( await screen.findByRole( 'menuitem', { name: 'Copy link' } ) );
	expect( connector.copyText ).toHaveBeenCalledExactlyOnceWith( second.url );
	expect( connector.pushSite ).not.toHaveBeenCalled();
} );

it( 'keeps registry order while defaulting to the last-used destination', async () => {
	localStorage.setItem( 'studio-last-publish-provider', 'spacefast' );
	setup( { getRemoteSites: async () => [], getSnapshots: async () => [] } );
	await open();
	expect( screen.getByText( 'Make it with Spacefast' ) ).toBeVisible();
	expect( screen.getByText( 'A fast, simple version of your pages' ) ).toBeVisible();
	expect(
		screen.getByText( 'Make your WordPress public with a link anyone can open.' )
	).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'Publish' } ) ).toBeVisible();
	expect( screen.getByRole( 'heading', { name: 'Share' } ) ).toBeVisible();
	fireEvent.click( screen.getByRole( 'button', { name: 'Destination' } ) );
	const picker = await screen.findByRole( 'menu', { name: 'Where to publish' } );
	expect( within( picker ).getAllByRole( 'menuitemradio' )[ 0 ] ).toHaveTextContent(
		'WordPress.com'
	);
	expect( within( picker ).getByText( 'The full WordPress, with a domain' ) ).toBeVisible();
	expect( within( picker ).getByText( 'A fast, simple version of your pages' ) ).toBeVisible();
} );
it( 'shows a static destination when the only publishing provider is connected', async () => {
	const { connector } = setup( {
		capabilities: { nativeSites: false },
		getRemoteSites: async () => [],
		getSnapshots: async () => [],
		getPreviewStatus: async () => ( {
			localSiteId: site.id,
			localChanged: false,
			previewChanged: false,
		} ),
	} );
	await open();
	expect( screen.getByText( 'Destination' ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'Destination' } ) ).not.toBeInTheDocument();
	fireEvent.click( screen.getByRole( 'button', { name: 'Make it public' } ) );
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	expect( screen.queryByRole( 'menu', { name: 'Where to publish' } ) ).not.toBeInTheDocument();
	await waitFor( () =>
		expect( connector.openExternalUrl ).toHaveBeenCalledWith( buildPublishCheckoutUrl( site ) )
	);
} );

it( 'publishes a new destination through its provider and selects it', async () => {
	let created = false;
	const { connector } = setup( {
		getSnapshots: async () => [],
		getRemoteSites: async ( provider ) => ( provider === 'spacefast' && created ? [ space ] : [] ),
		createRemoteSite: async () => {
			created = true;
			return space;
		},
	} );
	await open();
	fireEvent.click( screen.getByRole( 'button', { name: 'Destination' } ) );
	fireEvent.click( await screen.findByRole( 'menuitemradio', { name: /Spacefast A fast/ } ) );
	expect( connector.createRemoteSite ).not.toHaveBeenCalled();
	expect( connector.pushSite ).not.toHaveBeenCalled();
	fireEvent.click( await screen.findByRole( 'button', { name: 'Publish' } ) );
	await waitFor( () =>
		expect( connector.createRemoteSite ).toHaveBeenCalledExactlyOnceWith(
			'spacefast',
			site.id,
			site.name
		)
	);
	await waitFor( () =>
		expect( connector.pushSite ).toHaveBeenCalledExactlyOnceWith(
			'spacefast',
			site.id,
			space.id,
			undefined
		)
	);
	expect( await screen.findByRole( 'button', { name: 'lente.space.fast' } ) ).toBeVisible();
	expect( screen.queryByText( 'Some features may not work' ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBeVisible();
	expect( localStorage.getItem( 'studio-last-publish-provider' ) ).toBe( 'spacefast' );
} );

it( 'copies a selected preview without opening it, while the address opens its share URL', async () => {
	const { connector } = setup();
	await open();
	await switchTo( 'lente-preview.wpcomstaging.com' );
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Open preview: lente-preview.wpcomstaging.com' } )
	);
	expect( connector.openExternalUrl ).toHaveBeenCalledWith( preview.shareUrl );
	const viewPreview = await screen.findByRole( 'button', { name: 'Copy link' } );
	expect( viewPreview ).toHaveAttribute( 'data-variant', 'outline' );
	expect( screen.getByRole( 'button', { name: 'Copy link' } ) ).toHaveAttribute(
		'data-variant',
		'outline'
	);
	connector.openExternalUrl.mockClear();
	fireEvent.click( viewPreview );
	expect( connector.openExternalUrl ).not.toHaveBeenCalled();
	expect( connector.copyText ).toHaveBeenCalledWith( preview.shareUrl );
} );

it.each( [ 'selected', 'only' ] )(
	'removes the %s Spacefast connection only after confirmation',
	async ( state ) => {
		let removed = false;
		const { connector, user } = setup( {
			getRemoteSites: async ( provider ) =>
				provider === 'wpcom' ? ( state === 'only' ? [] : [ live ] ) : removed ? [] : [ space ],
			getSnapshots: async () => [],
			disconnectRemoteSite: async () => {
				removed = true;
			},
		} );
		await open();
		if ( state === 'selected' ) {
			await switchTo( 'lente.space.fast' );
			await screen.findByRole( 'button', { name: 'lente.space.fast' } );
		}
		const showConfirmation = async () => {
			const menu = await mainMenu();
			await user.click( within( menu ).getByRole( 'menuitem', { name: 'Disconnect site' } ) );
			return screen.findByRole( 'alertdialog', { name: 'Disconnect site?' } );
		};
		const cancelled = await showConfirmation();
		expect( cancelled ).toHaveTextContent(
			`Remove ${ space.url } from WordPress Studio? The published site and your local WordPress won’t change.`
		);
		await waitFor( () =>
			expect( within( cancelled ).getByRole( 'button', { name: 'Cancel' } ) ).toHaveFocus()
		);
		await user.click( within( cancelled ).getByRole( 'button', { name: 'Cancel' } ) );
		await waitFor( () => expect( cancelled ).not.toBeInTheDocument() );
		expect( connector.disconnectRemoteSite ).not.toHaveBeenCalled();

		await open();
		const confirmation = await showConfirmation();
		await user.click( within( confirmation ).getByRole( 'button', { name: 'Disconnect site' } ) );
		await waitFor( () => expect( confirmation ).not.toBeInTheDocument() );
		expect( connector.disconnectRemoteSite ).toHaveBeenCalledExactlyOnceWith(
			'spacefast',
			site.id,
			space.id
		);
		expect( connector.deleteSnapshot ).not.toHaveBeenCalled();

		await open();
		expect( screen.queryByRole( 'button', { name: 'lente.space.fast' } ) ).not.toBeInTheDocument();
		if ( state === 'only' ) {
			expect( await screen.findByRole( 'heading', { name: 'Share' } ) ).toBeVisible();
		} else {
			expect( await screen.findByRole( 'button', { name: 'lente.blog' } ) ).toBeVisible();
		}
	}
);

it( 'treats an upgraded preview as its published destination without duplicating it', async () => {
	setup( {
		getSnapshots: async () => [ { ...preview, atomicSiteId: live.id } ],
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [] ),
	} );
	await open();
	expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'Choose destination' } ) ).not.toBeInTheDocument();
} );

it( 'restores the default for an unavailable destination and changes help with selection', async () => {
	localStorage.setItem( 'studio-last-publish-provider', 'unknown-provider' );
	const { connector } = setup( { getRemoteSites: async () => [], getSnapshots: async () => [] } );
	await open();
	expect( screen.getByRole( 'button', { name: 'Create preview link' } ) ).toBeVisible();
	fireEvent.click( screen.getByRole( 'button', { name: 'Destination' } ) );
	const choice = await screen.findByRole( 'menuitemradio', {
		name: /WordPress.com The full WordPress/,
	} );
	expect( choice ).toBeChecked();
	fireEvent.click( screen.getByRole( 'menuitemradio', { name: /Spacefast A fast/ } ) );
	fireEvent.click( screen.getByRole( 'button', { name: 'Learn more' } ) );
	expect( connector.openExternalUrl ).toHaveBeenCalledExactlyOnceWith( 'https://spacefast.com' );
	expect( connector.createRemoteSite ).not.toHaveBeenCalled();
	fireEvent.click( screen.getByRole( 'button', { name: 'Destination' } ) );
	fireEvent.click(
		await screen.findByRole( 'menuitemradio', { name: /WordPress.com The full WordPress/ } )
	);
	expect( screen.getByRole( 'button', { name: 'Create preview link' } ) ).toBeVisible();
	expect( screen.getByText( 'The full WordPress, with a domain' ) ).toBeVisible();
	expect( screen.queryByText( 'Some features may not work' ) ).not.toBeInTheDocument();
} );

it( 'opens provider settings from the account prompt when no providers are connected', async () => {
	const { connector, history } = setup( {
		getAuthUser: async () => null,
		getAiSettings: async () => aiSettings( 'wpcom', [] ),
		getRemoteSites: async () => [],
		getSnapshots: async () => [],
	} );
	fireEvent.click( await screen.findByRole( 'button', { name: 'Share…' } ) );
	await screen.findByRole( 'dialog', { name: 'Share your WordPress' } );
	expect( screen.getByRole( 'button', { name: 'Continue with WordPress.com' } ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'Destination' } ) ).not.toBeInTheDocument();
	fireEvent.click( screen.getByRole( 'button', { name: 'Choose a different provider' } ) );
	await waitFor( () => expect( history.location.search ).toContain( 'settings=ai' ) );
	expect(
		screen.queryByRole( 'dialog', { name: 'Share your WordPress' } )
	).not.toBeInTheDocument();
	expect( screen.queryByRole( 'button', { name: 'Destination' } ) ).not.toBeInTheDocument();
	expect( connector.authenticate ).not.toHaveBeenCalled();
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
} );
it( 'defaults to the connected destination even when a disconnected provider was used last', async () => {
	localStorage.setItem( 'studio-last-publish-provider', 'wpcom' );
	const { history } = setup( {
		getAuthUser: async () => null,
		getAiSettings: async () => aiSettings( 'wpcom', [ 'spacefast' ] ),
		getRemoteSites: async () => [],
		getSnapshots: async () => [],
	} );
	await open();
	expect( await screen.findByText( 'Spacefast' ) ).toBeVisible();
	expect( screen.getByText( 'A fast, simple version of your pages' ) ).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'Destination' } ) ).toBeVisible();
	expect( screen.queryByText( 'WordPress.com' ) ).not.toBeInTheDocument();
	expect( screen.queryByRole( 'button', { name: 'Create preview link' } ) ).not.toBeInTheDocument();
	expect(
		screen.queryByRole( 'dialog', { name: 'Share your WordPress' } )
	).not.toBeInTheDocument();
	fireEvent.click( screen.getByRole( 'button', { name: 'Destination' } ) );
	expect( await screen.findByRole( 'menuitemradio', { name: /Spacefast/ } ) ).toBeChecked();
	expect( screen.getAllByRole( 'menuitemradio' ) ).toHaveLength( 1 );
	fireEvent.click( screen.getByRole( 'menuitem', { name: 'Connect more providers' } ) );
	await waitFor( () => expect( history.location.search ).toContain( 'settings=ai' ) );
} );

it( 'publishes a connected destination without leaving the main panel', async () => {
	let finish!: ( value: typeof space ) => void;
	const creation = new Promise< typeof space >( ( resolve ) => {
		finish = resolve;
	} );
	const { connector } = setup( {
		getAuthUser: async () => null,
		getAiSettings: async () => aiSettings( 'wpcom', [ 'spacefast' ] ),
		getRemoteSites: async () => [],
		getSnapshots: async () => [],
		createRemoteSite: async () => creation,
	} );
	await open();
	fireEvent.click( screen.getByRole( 'button', { name: 'Publish' } ) );
	await waitFor( () =>
		expect( connector.createRemoteSite ).toHaveBeenCalledExactlyOnceWith(
			'spacefast',
			site.id,
			site.name
		)
	);
	expect( screen.getByRole( 'heading', { name: 'Share' } ) ).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'Destination' } ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'Back' } ) ).not.toBeInTheDocument();
	expect( connector.startProviderConnect ).not.toHaveBeenCalled();
	finish( space );
	await waitFor( () =>
		expect( connector.pushSite ).toHaveBeenCalledExactlyOnceWith(
			'spacefast',
			site.id,
			space.id,
			undefined
		)
	);
} );

it( 'copies a published link briefly and still opens the site from its URL row', async () => {
	const { connector } = setup( { getSitePublishStatus: async () => ( { localChanged: false } ) } );
	await open();
	await switchTo( 'lente.space.fast' );
	fireEvent.click( await screen.findByRole( 'button', { name: 'Copy link' } ) );
	await waitFor( () => expect( connector.copyText ).toHaveBeenCalledWith( space.url ) );
	expect( await screen.findByRole( 'button', { name: 'Copied' } ) ).toBeVisible();
	await screen.findByRole( 'button', { name: 'Copy link' }, { timeout: 3000 } );
	fireEvent.click( screen.getByRole( 'button', { name: 'lente.space.fast' } ) );
	expect( connector.openExternalUrl ).toHaveBeenCalledExactlyOnceWith( space.url );
	fireEvent.click( screen.getByRole( 'button', { name: 'Choose destination' } ) );
	expect( await screen.findByRole( 'menuitem', { name: 'New preview' } ) ).toBeEnabled();
} );

it( 'keeps the confirmed live state while destination metadata refreshes', async () => {
	const { connector, queryClient } = setup( {
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [] ),
		getSnapshots: async () => [],
	} );
	await open();
	await screen.findByText( 'Your latest changes are live.' );
	let finish!: ( value: { localChanged: boolean } ) => void;
	connector.getSitePublishStatus.mockImplementation(
		() =>
			new Promise( ( resolve ) => {
				finish = resolve;
			} )
	);
	act( () => {
		queryClient.setQueryData( remoteSitesQueryKey( 'wpcom', site.id ), [
			{ ...live, lastPushTimestamp: new Date( Date.now() + 1000 ).toISOString() },
		] );
	} );
	await waitFor( () => expect( finish ).toBeDefined() );
	expect( screen.getByText( 'Your latest changes are live.' ) ).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'Copy link' } ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'Publish changes' } ) ).not.toBeInTheDocument();
	await act( async () => finish( { localChanged: false } ) );
} );

it( 'holds publishing until the completed destination check returns', async () => {
	const { connector } = setup( {
		getRemoteSites: async ( provider ) => ( provider === 'spacefast' ? [ space ] : [] ),
		getSnapshots: async () => [],
		pushSite: async () => new Promise( () => {} ),
	} );
	await open();
	fireEvent.click( await screen.findByRole( 'button', { name: 'Publish changes' } ) );
	await screen.findByRole( 'button', { name: 'Publishing…' } );
	expect( screen.getByText( 'Published just now' ) ).toBeVisible();
	act( () =>
		connector.emit( 'onSyncActivity', {
			siteId: site.id,
			activity: { kind: 'pending', direction: 'push', provider: 'spacefast' },
		} )
	);
	expect( screen.getByText( 'Your changes will be live in a moment.' ) ).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'Publishing…' } ) ).toBeVisible();
	expect( screen.queryByLabelText( 'Local changes' ) ).not.toBeInTheDocument();
	let finish!: ( value: { localChanged: boolean } ) => void;
	connector.getSitePublishStatus.mockImplementation(
		() =>
			new Promise( ( resolve ) => {
				finish = resolve;
			} )
	);
	act( () =>
		connector.emit( 'onSyncActivity', {
			siteId: site.id,
			activity: {
				kind: 'success',
				direction: 'push',
				provider: 'spacefast',
				remoteSiteId: space.id,
			},
		} )
	);
	await waitFor( () => expect( finish ).toBeDefined() );
	expect( screen.getByText( 'Your changes will be live in a moment.' ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'Publish changes' } ) ).not.toBeInTheDocument();
	await act( async () => finish( { localChanged: false } ) );
	await screen.findByText( 'Your latest changes are live.' );
	expect( screen.getByRole( 'button', { name: 'Copy link' } ) ).toBeVisible();
} );

it( 'shows an actionable Publish changes button once publish checks finish', async () => {
	let finish!: ( value: number ) => void;
	setup( {
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [] ),
		getSnapshots: async () => [],
		getSitePublishStatus: async () => ( { localChanged: true } ),
		getDirectorySize: async () => new Promise( ( resolve ) => ( finish = resolve ) ),
	} );
	await open();
	await waitFor( () => expect( finish ).toBeDefined() );
	expect( screen.getByRole( 'button', { name: 'Checking…' } ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'Publish changes' } ) ).not.toBeInTheDocument();
	await act( async () => finish( 1 ) );
	expect( await screen.findByRole( 'button', { name: 'Publish changes' } ) ).toBeEnabled();
} );

it.each( [ 'wpcom', 'spacefast' ] as const )(
	'shows the saved publish time for %s destinations',
	async ( provider ) => {
		setup( {
			getRemoteSites: async ( id ) =>
				id === provider
					? [
							{
								...( provider === 'wpcom' ? live : space ),
								lastPushTimestamp: new Date().toISOString(),
							},
					  ]
					: [],
			getSnapshots: async () => [],
			getSitePublishStatus: async () => ( { localChanged: false } ),
		} );
		await open();
		expect( await screen.findByText( 'Published just now' ) ).toBeVisible();
		expect( await screen.findByText( 'Your latest changes are live.' ) ).toBeVisible();
	}
);

it( 'publishes everything on the first WordPress.com push and then shows the checklist', async () => {
	let lastPushTimestamp: string | null = null;
	let finish!: () => void;
	const { connector, queryClient, user } = setup( {
		listAccountSites: async ( provider ) =>
			provider === 'wpcom' ? [ { ...live, launchStatus: 'unlaunched' } ] : [],
		getRemoteSites: async ( provider ) =>
			provider === 'wpcom'
				? [ { ...live, lastPushTimestamp, launchAfterPush: true, launchStatus: 'unlaunched' } ]
				: [],
		getSnapshots: async () => [],
		getSitePublishStatus: async () => ( { localChanged: false } ),
		pushSite: async () => {
			await new Promise< void >( ( resolve ) => ( finish = resolve ) );
			lastPushTimestamp = live.lastPushTimestamp;
		},
	} );
	queryClient.setQueryData( [ 'publish-selection', site.id, 'wpcom', live.id, 'push' ], {
		scope: 'files',
		nodes: [],
		content: false,
	} );
	await open();
	expect( await screen.findByText( 'Not published yet' ) ).toBeVisible();
	expect( screen.getByText( 'Publish your WordPress when you’re ready.' ) ).toBeVisible();
	expect( screen.getByLabelText( 'Local changes' ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'What to publish' } ) ).not.toBeInTheDocument();
	const publish = screen.getByRole( 'button', { name: 'Publish' } );
	await waitFor( () => expect( publish ).toBeEnabled() );
	await user.click( publish );
	expect( await screen.findByRole( 'button', { name: 'Publishing…' } ) ).toBeVisible();
	expect( connector.pushSite ).toHaveBeenCalledExactlyOnceWith( 'wpcom', site.id, live.id, {
		optionsToSync: [ 'all' ],
	} );
	await act( async () => finish() );
	act( () =>
		connector.emit( 'onSyncActivity', {
			siteId: site.id,
			activity: { kind: 'success', direction: 'push', provider: 'wpcom', remoteSiteId: live.id },
		} )
	);
	expect( await screen.findByRole( 'button', { name: 'What to publish' } ) ).toBeVisible();
	expect( await screen.findByRole( 'button', { name: 'Copy link' } ) ).toBeVisible();
	expect( screen.queryByLabelText( 'Local changes' ) ).not.toBeInTheDocument();
} );

it( 'uses Publish for a Spacefast destination before its first successful push', async () => {
	let lastPushTimestamp: string | null = null;
	let finish!: () => void;
	const { connector, user } = setup( {
		getRemoteSites: async ( provider ) =>
			provider === 'spacefast' ? [ { ...space, lastPushTimestamp } ] : [],
		listAccountSites: async () => [],
		getSnapshots: async () => [],
		getSitePublishStatus: async () => ( { localChanged: !! lastPushTimestamp } ),
		pushSite: async () => {
			await new Promise< void >( ( resolve ) => ( finish = resolve ) );
			lastPushTimestamp = space.lastPushTimestamp;
		},
	} );
	const panel = await open();
	expect( await within( panel ).findByText( 'Not published yet' ) ).toBeVisible();
	expect( screen.getByLabelText( 'Local changes' ) ).toBeVisible();
	await user.click( within( panel ).getByRole( 'button', { name: 'Publish' } ) );
	expect( await within( panel ).findByRole( 'button', { name: 'Publishing…' } ) ).toBeVisible();
	expect( connector.pushSite ).toHaveBeenCalledExactlyOnceWith(
		'spacefast',
		site.id,
		space.id,
		undefined
	);
	await act( async () => finish() );
	act( () =>
		connector.emit( 'onSyncActivity', {
			siteId: site.id,
			activity: {
				kind: 'success',
				direction: 'push',
				provider: 'spacefast',
				remoteSiteId: space.id,
			},
		} )
	);
	expect( await within( panel ).findByRole( 'button', { name: 'Publish changes' } ) ).toBeVisible();
} );

it( 'hides the publish-time line when no timestamp was saved', async () => {
	setup( {
		getRemoteSites: async ( provider ) =>
			provider === 'wpcom' ? [ { ...live, lastPushTimestamp: '' } ] : [],
		getSnapshots: async () => [],
	} );
	await open();
	await screen.findByText( 'Publish your WordPress when you’re ready.' );
	expect( screen.queryByText( 'Not published yet' ) ).not.toBeInTheDocument();
	expect( document.querySelector( 'time' ) ).not.toBeInTheDocument();
} );

it( 'hides the connect-more action when all publishing providers are connected', async () => {
	const { user } = setup( { getRemoteSites: async () => [], getSnapshots: async () => [] } );
	const panel = await open();
	expect( within( panel ).getByRole( 'button', { name: 'Create preview link' } ) ).toBeVisible();
	await user.click( within( panel ).getByRole( 'button', { name: 'More options' } ) );
	const menuItems = await screen.findAllByRole( 'menuitem' );
	expect( menuItems ).toHaveLength( 3 );
	expect( menuItems[ 0 ] ).toHaveAccessibleName( 'New preview' );
	expect( menuItems[ 1 ] ).toHaveAccessibleName( 'Connect existing site' );
	expect( menuItems[ 2 ] ).toHaveAccessibleName( 'Manage sharing' );
	await user.keyboard( '{Escape}' );
	fireEvent.click( await screen.findByRole( 'button', { name: 'Destination' } ) );
	const menu = await screen.findByRole( 'menu', { name: 'Where to publish' } );
	expect( within( menu ).getAllByRole( 'menuitemradio' ) ).toHaveLength( 2 );
	expect(
		within( menu ).queryByRole( 'menuitem', { name: 'Connect more providers' } )
	).not.toBeInTheDocument();
	expect( within( menu ).queryByRole( 'separator' ) ).not.toBeInTheDocument();
} );

it.each( [ false, true ] )(
	'connects an existing live site without transferring when a preview exists: %s',
	async ( hasPreview ) => {
		let connected = false;
		const destination = { ...live, lastPushTimestamp: null };
		const { connector, user } = setup( {
			getSnapshots: async () => ( hasPreview ? [ preview ] : [] ),
			getRemoteSites: async ( provider ) =>
				provider === 'wpcom' && connected ? [ destination ] : [],
			listAccountSites: async ( provider ) => ( provider === 'wpcom' ? [ destination ] : [] ),
			connectRemoteSite: async () => {
				connected = true;
			},
		} );
		await open();
		const menu = await mainMenu();
		await user.click( within( menu ).getByRole( 'menuitem', { name: 'Connect existing site' } ) );
		const dialog = await screen.findByRole( 'dialog', { name: 'Choose an existing site' } );
		await user.click( await within( dialog ).findByRole( 'button', { name: /Live.*lente.blog/ } ) );
		expect( await screen.findByRole( 'button', { name: 'Publish' } ) ).toBeVisible();
		expect( connector.connectRemoteSite ).toHaveBeenCalledExactlyOnceWith(
			'wpcom',
			site.id,
			destination
		);
		expect( connector.pushSite ).not.toHaveBeenCalled();
		expect( connector.pullSite ).not.toHaveBeenCalled();
	}
);

it( 'preserves selective publishing on the first push to an existing live site', async () => {
	const destination = { ...live, lastPushTimestamp: null };
	const { connector, user } = setup( {
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ destination ] : [] ),
		listAccountSites: async ( provider ) => ( provider === 'wpcom' ? [ destination ] : [] ),
	} );
	await open();
	expect( await screen.findByText( /Publishing the database replaces/ ) ).toBeVisible();
	await user.click( screen.getByRole( 'button', { name: 'What to publish' } ) );
	await user.click( await screen.findByRole( 'checkbox', { name: /Database/ } ) );
	await user.keyboard( '{Escape}' );
	await user.click( screen.getByRole( 'button', { name: /^Publish$/ } ) );
	expect( connector.pushSite ).toHaveBeenCalledWith(
		'wpcom',
		site.id,
		live.id,
		expect.objectContaining( {
			optionsToSync: expect.not.arrayContaining( [ 'all' ] ),
		} )
	);
	expect( connector.pushSite.mock.calls[ 0 ][ 3 ]?.optionsToSync ).not.toContain( 'sqls' );
} );

it( 'waits for the exact pull destination requested before connections load', async () => {
	const destination = { ...live, id: 43, url: 'https://staging.lente.blog' };
	let resolveConnections!: ( sites: ( typeof live )[] ) => void;
	const connections = new Promise< ( typeof live )[] >( ( resolve ) => {
		resolveConnections = resolve;
	} );
	const { connector, user } = setup( {
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? connections : [ space ] ),
		listAccountSites: async ( provider ) =>
			provider === 'wpcom' ? [ live, destination ] : [ space ],
	} );
	act( () =>
		requestHeaderPanel( {
			panel: 'publish',
			siteId: site.id,
			view: 'pull',
			provider: 'wpcom',
			remoteSiteId: destination.id,
		} )
	);
	expect( screen.queryByRole( 'alertdialog' ) ).not.toBeInTheDocument();
	await act( async () => resolveConnections( [ live, destination ] ) );
	const dialog = await screen.findByRole( 'alertdialog', { name: 'Pull from live site?' } );
	expect( dialog ).toHaveTextContent( 'Pull from staging.lente.blog.' );
	await user.click( within( dialog ).getByRole( 'button', { name: 'Pull changes' } ) );
	expect( connector.pullSite ).toHaveBeenCalledWith(
		'wpcom',
		site.id,
		destination.id,
		expect.anything()
	);
} );

it( 'chooses a live site before creating a preview when several sites qualify', async () => {
	const another = { ...live, id: 43, name: 'Another live site', url: 'https://other.blog' };
	const { connector, user } = setup( {
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ live, another ] : [] ),
		listAccountSites: async ( provider ) => ( provider === 'wpcom' ? [ live, another ] : [] ),
	} );
	await open();
	await user.click( screen.getByRole( 'button', { name: 'Choose destination' } ) );
	await user.click( await screen.findByRole( 'menuitem', { name: 'New preview' } ) );
	const dialog = await screen.findByRole( 'dialog', { name: 'Live site' } );
	const select = within( dialog ).getByRole( 'combobox', { name: 'Live site' } );
	expect( select ).toHaveTextContent( 'None' );
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	await user.click( select );
	await user.click( await screen.findByRole( 'option', { name: 'Another live site' } ) );
	await user.click( within( dialog ).getByRole( 'button', { name: 'Create preview link' } ) );
	await waitFor( () =>
		expect( connector.publishPreviewSite ).toHaveBeenCalledExactlyOnceWith(
			site.id,
			undefined,
			undefined,
			'43'
		)
	);
} );

it( 'commits individual files on Done and discards a later unfinished edit', async () => {
	const { connector, user } = setup( {
		getSitePublishStatus: async () => ( { localChanged: true } ),
		listLocalFileTree: async () => [
			{ name: 'style.css', path: 'wp-content/themes/site/style.css', isDirectory: false },
			{ name: 'theme.json', path: 'wp-content/themes/site/theme.json', isDirectory: false },
		],
	} );
	await open();
	const openFiles = async () => {
		await user.click( screen.getByRole( 'button', { name: 'What to publish' } ) );
		await user.click( await screen.findByRole( 'button', { name: 'Choose individual files…' } ) );
		return screen.findByRole( 'dialog', { name: 'Choose individual files' } );
	};
	let dialog = await openFiles();
	await user.click( await within( dialog ).findByRole( 'checkbox', { name: 'theme.json' } ) );
	await user.click( within( dialog ).getByRole( 'checkbox', { name: 'Content and settings' } ) );
	await user.click( within( dialog ).getByRole( 'button', { name: 'Done' } ) );
	expect( connector.pushSite ).not.toHaveBeenCalled();
	dialog = await openFiles();
	await user.click( await within( dialog ).findByRole( 'checkbox', { name: 'theme.json' } ) );
	await user.keyboard( '{Escape}' );
	await user.click( await screen.findByRole( 'button', { name: 'Publish changes' } ) );
	await waitFor( () =>
		expect( connector.pushSite ).toHaveBeenCalledExactlyOnceWith( 'wpcom', site.id, live.id, {
			optionsToSync: [ 'themes' ],
			specificSelectionPaths: [ 'themes/site/style.css' ],
		} )
	);
} );

it( 'shows which live site a preview represents and warns before publishing newer changes', async () => {
	const linked = { ...preview, liveSiteId: live.id, versionId: 'old-version' };
	const { connector } = setup( {
		getSnapshots: async () => [ linked ],
		getSitePublishStatus: async () => ( { localChanged: true } ),
		getPreviewStatus: async () => ( {
			localSiteId: site.id,
			localChanged: true,
			previewChanged: false,
		} ),
	} );
	await open();
	expect( await screen.findByText( /including changes not shown in that preview/ ) ).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'Publish changes' } ) ).toBeEnabled();
	await switchTo( preview.url );
	expect( await screen.findByText( /Changes to Live · Expires/ ) ).toBeVisible();
	expect( connector.pushSite ).not.toHaveBeenCalled();
} );

it( 'retries a delayed checkout connection without reopening the browser', async () => {
	let connected = false;
	const destination = { ...live, lastPushTimestamp: null };
	const { connector, user } = setup( {
		getRemoteSites: async ( provider ) =>
			provider === 'wpcom' && connected ? [ destination ] : [],
		listAccountSites: async () => [],
		connectRemoteSite: async () => {
			connected = true;
		},
	} );
	await open();
	await user.click( screen.getByRole( 'button', { name: 'Make it public' } ) );
	await screen.findByRole( 'button', { name: 'Reopen WordPress.com' } );
	act( () =>
		connector.emit( 'onSyncConnectSite', {
			studioSiteId: site.id,
			remoteSiteId: live.id,
			autoOpenPush: true,
		} )
	);
	const retry = await screen.findByRole( 'button', { name: 'Try again' } );
	connector.listAccountSites.mockResolvedValue( [ destination ] );
	await user.click( retry );
	expect( await screen.findByRole( 'button', { name: 'Publish' } ) ).toBeVisible();
	expect( connector.openExternalUrl ).toHaveBeenCalledTimes( 1 );
	expect( connector.pushSite ).not.toHaveBeenCalled();
} );

it( 'uses the shared visibility picker with Spacefast options and saves restricted access', async () => {
	const { user, connector } = setup( {
		setSiteVisibility: async () => ( { visibility: 'private', url: space.url } ),
	} );
	await open();
	await switchTo( 'lente.space.fast' );
	await user.click( screen.getByRole( 'button', { name: 'Who can view' } ) );
	expect( await screen.findByRole( 'menuitemradio', { name: 'Everyone' } ) ).toBeChecked();
	expect( screen.getByRole( 'menuitemradio', { name: 'Restricted' } ) ).toHaveAccessibleDescription(
		'Only people with access can view'
	);
	expect( screen.queryByText( 'Visitors see a coming soon page' ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'menuitem', { name: 'Manage on Spacefast' } ) ).toBeVisible();
	await user.click( screen.getByRole( 'menuitemradio', { name: 'Restricted' } ) );
	await waitFor( () =>
		expect( connector.setSiteVisibility ).toHaveBeenCalledWith( 'spacefast', space.id, 'private' )
	);
	await waitFor( () =>
		expect( screen.getByRole( 'button', { name: 'Who can view' } ) ).toHaveAccessibleDescription(
			'Restricted'
		)
	);
} );

it( 'disables unsupported access changes but leaves provider management available', async () => {
	const { user } = setup( {
		getSiteVisibility: async ( provider ) => ( {
			visibility: 'unknown',
			url: provider === 'spacefast' ? space.url : live.url,
			availableValues: [],
			message: 'Manage these access rules on Spacefast.',
		} ),
	} );
	await open();
	await switchTo( 'lente.space.fast' );
	await user.click( screen.getByRole( 'button', { name: 'Who can view' } ) );
	for ( const option of await screen.findAllByRole( 'menuitemradio' ) )
		expect( option ).toHaveAttribute( 'aria-disabled', 'true' );
	expect( screen.getByRole( 'menuitem', { name: 'Manage on Spacefast' } ) ).not.toHaveAttribute(
		'aria-disabled',
		'true'
	);
} );

it( 'opens the selected provider domain settings from the published panel', async () => {
	const { user, connector } = setup();
	await open();
	expect( screen.queryByRole( 'button', { name: 'Manage domain' } ) ).not.toBeInTheDocument();
	await switchTo( 'lente.space.fast' );
	await user.click( await screen.findByRole( 'button', { name: 'Manage domain' } ) );
	expect( connector.openExternalUrl ).toHaveBeenCalledWith(
		'https://my.spacefast.com/studio/lente/domains'
	);
} );

it( 'offers publishing again from the current-site description', async () => {
	const { user } = setup();
	await open();
	await user.click( await screen.findByRole( 'button', { name: 'Publish again…' } ) );
	expect( await screen.findByRole( 'alertdialog', { name: 'Publish again?' } ) ).toBeVisible();
} );

it( 'keeps preview creation available during a background availability refresh', async () => {
	const { connector, queryClient } = setup( {
		getSnapshots: async () => [],
		getRemoteSites: async () => [],
	} );
	await open();
	const button = await screen.findByRole( 'button', { name: 'Create preview link' } );
	await waitFor( () => expect( button ).toBeEnabled() );
	connector.getSnapshotUsage.mockImplementationOnce( () => new Promise( () => {} ) );
	act( () => {
		void queryClient.invalidateQueries( { queryKey: SNAPSHOT_USAGE_QUERY_KEY } );
	} );
	await waitFor( () =>
		expect( queryClient.isFetching( { queryKey: SNAPSHOT_USAGE_QUERY_KEY } ) ).toBeGreaterThan( 0 )
	);
	expect( button ).toBeEnabled();
} );

it.each( [ 1, 2 ] )(
	'shows the preview selector only for multiple previews (%s)',
	async ( count ) => {
		setup( {
			getRemoteSites: async () => [],
			getSnapshots: async () =>
				count === 1
					? [ preview ]
					: [ preview, { ...preview, atomicSiteId: 456, url: 'second.wpcomstaging.com' } ],
		} );
		await open();
		expect( !! screen.queryByRole( 'button', { name: 'Choose destination' } ) ).toBe( count > 1 );
		expect( !! screen.queryByRole( 'heading', { name: 'Switch previews' } ) ).toBe( count > 1 );
		const menu = await mainMenu();
		expect( within( menu ).getByRole( 'menuitem', { name: 'New preview' } ) ).toBeEnabled();
	}
);

it( 'shows a skeleton preview selector while creating a second preview', async () => {
	const { user } = setup( {
		getRemoteSites: async () => [],
		publishPreviewSite: () => new Promise( () => {} ),
	} );
	await open();
	expect( screen.queryByRole( 'button', { name: 'Choose destination' } ) ).not.toBeInTheDocument();
	const menu = await mainMenu();
	await user.click( within( menu ).getByRole( 'menuitem', { name: 'New preview' } ) );
	expect( await screen.findByRole( 'heading', { name: 'Switch previews' } ) ).toBeVisible();
	const selector = screen.getByRole( 'button', { name: 'Choose destination' } );
	expect( selector ).toBeDisabled();
	expect( selector ).toHaveAttribute( 'aria-busy', 'true' );
} );

it( 'searches existing sites and explains unavailable destinations in the shared picker', async () => {
	const unavailable = {
		...live,
		id: 99,
		name: 'Unavailable blog',
		syncSupport: 'missing-permissions' as const,
	};
	const { user, connector } = setup( {
		getRemoteSites: async () => [],
		getSnapshots: async () => [],
		listAccountSites: async () => [ live, unavailable ],
	} );
	await open();
	const menu = await mainMenu();
	await user.click( within( menu ).getByRole( 'menuitem', { name: 'Connect existing site' } ) );
	const dialog = await screen.findByRole( 'dialog', { name: 'Choose an existing site' } );
	expect(
		await within( dialog ).findByRole( 'button', { name: /Unavailable blog/ } )
	).toBeDisabled();
	await user.type(
		within( dialog ).getByRole( 'searchbox', { name: 'Search sites' } ),
		'Unavailable'
	);
	expect( within( dialog ).queryByRole( 'button', { name: /^Live / } ) ).not.toBeInTheDocument();
	expect( within( dialog ).getByRole( 'heading', { name: 'Unavailable' } ) ).toBeVisible();
	expect( connector.connectRemoteSite ).not.toHaveBeenCalled();
} );
