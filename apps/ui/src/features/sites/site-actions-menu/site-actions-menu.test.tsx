import { DESIGN_SYSTEM_PREVIEW_PATH } from '@studio/common/ai/chat-artifacts';
import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscribeHeaderPanelRequest } from '@/data/use-open-header-panel';
import { SessionUIProvider, useSessionPreviewUI } from '@/data/use-session-ui';
import { SiteContextMenu } from '@/features/sites/stopped-site-preview';
import { createFakeConnector, makeSite, TEST_USER } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { SiteActionsMenu } from './index';
import type { SyncSite } from '@/data/core';

const DATABASE_PATH = '/phpmyadmin/index.php?route=/database/structure&db=wordpress';
const autoLogin = ( path: string ) =>
	`/studio-auto-login?redirect_to=${ encodeURIComponent( `http://localhost:9010${ path }` ) }`;

const unsubscribers: Array< () => void > = [];
afterEach( () => unsubscribers.splice( 0 ).forEach( ( unsubscribe ) => unsubscribe() ) );

function PreviewProbe() {
	const preview = useSessionPreviewUI();
	return (
		<output aria-label="Preview">
			{ preview.open && preview.siteId ? `${ preview.siteId } ${ preview.path }` : '' }
		</output>
	);
}

function setup( {
	otherRunning = true,
	selectedRunning = true,
	contextMenu = false,
	busy = false,
	designAvailable = false,
	connections,
}: {
	otherRunning?: boolean;
	selectedRunning?: boolean;
	contextMenu?: boolean;
	busy?: boolean;
	designAvailable?: boolean;
	connections?: SyncSite[];
} = {} ) {
	const sites = [
		makeSite( { id: 'selected', name: 'Selected', running: selectedRunning, port: 9010 } ),
		makeSite( { id: 'other', name: 'Other', running: otherRunning } ),
		makeSite( { id: 'stopped', name: 'Stopped', running: false } ),
	];
	const connector = createFakeConnector(
		{ sites, user: connections ? TEST_USER : null },
		{
			getConnectedWpcomSites: async () => connections ?? [],
			getGlobalStyles: async () => ( designAvailable ? { settings: {}, styles: {} } : null ),
		}
	);
	const site = busy
		? { ...sites[ 0 ], operation: { pid: 1, kind: 'settings' as const } }
		: sites[ 0 ];
	const requests = { share: vi.fn(), publish: vi.fn() };
	unsubscribers.push(
		subscribeHeaderPanelRequest( 'selected', 'share', requests.share ),
		subscribeHeaderPanelRequest( 'selected', 'publish', requests.publish )
	);
	const view = renderWithProviders(
		<SessionUIProvider>
			{ contextMenu ? (
				<SiteContextMenu site={ site } disabled={ false }>
					<button>Site row</button>
				</SiteContextMenu>
			) : (
				<SiteActionsMenu site={ site } />
			) }
			<PreviewProbe />
		</SessionUIProvider>,
		{ connector }
	);
	const open = async () => {
		if ( contextMenu ) {
			fireEvent.contextMenu( await screen.findByRole( 'button', { name: 'Site row' } ) );
		} else {
			fireEvent.click( await screen.findByRole( 'button', { name: 'Site actions for Selected' } ) );
		}
	};
	return { ...view, connector, requests, open };
}

describe( 'Stop other sites', () => {
	it.each( [ false, true ] )(
		'disables submenus with no available actions in either menu (%s)',
		async ( contextMenu ) => {
			const { open } = setup( { contextMenu, busy: true } );
			await open();
			for ( const name of [ 'Go to' ] ) {
				const trigger = await screen.findByRole( 'menuitem', { name } );
				expect( trigger ).toHaveAttribute( 'aria-disabled', 'true' );
				fireEvent.click( trigger );
				expect( screen.getAllByRole( 'menu' ) ).toHaveLength( 1 );
			}
			const openIn = screen.getByRole( 'menuitem', { name: 'Open in' } );
			expect( openIn ).not.toHaveAttribute( 'aria-disabled', 'true' );
			fireEvent.click( openIn );
			expect( await screen.findByRole( 'menuitem', { name: 'Finder' } ) ).not.toHaveAttribute(
				'aria-disabled',
				'true'
			);
		}
	);

	it.each( [ false, true ] )(
		'opens sharing and sync from either menu (%s)',
		async ( contextMenu ) => {
			for ( const action of [ 'Share', 'Publish' ] ) {
				const { open, requests } = setup( { contextMenu } );
				await open();
				const share = await screen.findByRole( 'menuitem', { name: 'Share' } );
				const sync = screen.getByRole( 'menuitem', { name: 'Publish' } );
				const items = screen.getAllByRole( 'menuitem' );
				expect( items[ items.indexOf( share ) + 1 ] ).toBe( sync );
				expect( items[ items.indexOf( share ) - 1 ] ).toHaveTextContent( 'Duplicate' );
				expect( items[ items.indexOf( sync ) + 1 ] ).toHaveTextContent( 'Delete site' );
				fireEvent.click( action === 'Share' ? share : sync );
				if ( action === 'Share' ) {
					expect( requests.share ).toHaveBeenCalledExactlyOnceWith( {
						panel: 'share',
						siteId: 'selected',
					} );
				} else {
					expect( requests.publish ).toHaveBeenCalledExactlyOnceWith( {
						panel: 'publish',
						siteId: 'selected',
						view: 'publish',
						remoteSiteId: undefined,
					} );
				}
				cleanup();
				unsubscribers.splice( 0 ).forEach( ( unsubscribe ) => unsubscribe() );
			}
		}
	);

	it( 'keeps the header and context menus identical', async () => {
		const readMenu = () =>
			screen.getAllByRole( 'menuitem' ).map( ( item ) => ( {
				label: item.textContent?.replace( /Ctrl\+Alt\+S|⌥⌘S/g, '' ),
				disabled: item.getAttribute( 'aria-disabled' ),
				submenu: item.getAttribute( 'aria-haspopup' ),
			} ) );
		const header = setup();
		await header.open();
		await screen.findByRole( 'menuitem', { name: 'Stop' } );
		const headerItems = readMenu();
		cleanup();
		const context = setup( { contextMenu: true } );
		await context.open();
		await screen.findByRole( 'menuitem', { name: 'Stop' } );
		expect( readMenu() ).toEqual( headerItems );
	} );

	it.each( [ false, true ] )(
		'omits new chat from either site menu (%s)',
		async ( contextMenu ) => {
			const { open } = setup( { contextMenu } );
			await open();
			await screen.findByRole( 'menuitem', { name: 'Stop' } );
			expect( screen.queryByRole( 'menuitem', { name: 'New chat' } ) ).not.toBeInTheDocument();
		}
	);

	it.each( [ false, true ] )(
		'opens settings focused on the name from either menu (%s)',
		async ( contextMenu ) => {
			const { open, history } = setup( { contextMenu } );
			await open();
			fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Rename' } ) );
			await waitFor( () =>
				expect( Object.fromEntries( new URLSearchParams( history.location.search ) ) ).toEqual( {
					settings: 'site',
					settingsSite: 'selected',
					settingsFocus: 'Site name',
				} )
			);
		}
	);

	it.each( [
		[ 'WordPress Admin', autoLogin( '/wp-admin/' ) ],
		[ 'Database', DATABASE_PATH ],
	] )( 'navigates to %s for the menu site', async ( label, path ) => {
		const { open, history } = setup();
		await open();
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Go to' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: label } ) );
		await waitFor( () =>
			expect( screen.getByRole( 'status', { name: 'Preview' } ) ).toHaveTextContent(
				`selected ${ path }`
			)
		);
		expect( history.location.pathname ).toBe( '/sites/selected' );
	} );

	it.each( [ false, true ] )(
		'opens an available design system from either menu (%s)',
		async ( contextMenu ) => {
			const { open, history } = setup( { contextMenu, designAvailable: true } );
			await open();
			fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Go to' } ) );
			fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Design system' } ) );
			await waitFor( () =>
				expect( screen.getByRole( 'status', { name: 'Preview' } ) ).toHaveTextContent(
					`selected ${ DESIGN_SYSTEM_PREVIEW_PATH }`
				)
			);
			expect( history.location.pathname ).toBe( '/sites/selected' );
		}
	);

	it( 'omits the design system when the site has none', async () => {
		const { open } = setup();
		await open();
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Go to' } ) );
		expect( await screen.findByRole( 'menuitem', { name: 'Database' } ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'menuitem', { name: 'Design system' } ) ).not.toBeInTheDocument();
	} );

	it( 'omits the design system while the site is stopped', async () => {
		const { open } = setup( { selectedRunning: false, designAvailable: true } );
		await open();
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Go to' } ) );
		expect( await screen.findByRole( 'menuitem', { name: 'Database' } ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'menuitem', { name: 'Design system' } ) ).not.toBeInTheDocument();
	} );

	it.each( [
		[ 'WordPress Admin', autoLogin( '/wp-admin/' ) ],
		[ 'Database', DATABASE_PATH ],
	] )( 'starts a stopped site before opening %s', async ( label, path ) => {
		const { open, connector } = setup( { selectedRunning: false } );
		await open();
		let finishStart!: () => void;
		connector.startSite.mockImplementation(
			() =>
				new Promise( ( resolve ) => {
					finishStart = () => resolve();
				} )
		);
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Go to' } ) );
		const item = await screen.findByRole( 'menuitem', { name: label } );
		expect( item ).not.toHaveAttribute( 'aria-disabled', 'true' );
		fireEvent.click( item );
		await waitFor( () =>
			expect( connector.startSite ).toHaveBeenCalledExactlyOnceWith( 'selected' )
		);
		expect( screen.getByRole( 'status', { name: 'Preview' } ) ).toBeEmptyDOMElement();
		finishStart();
		await waitFor( () =>
			expect( screen.getByRole( 'status', { name: 'Preview' } ) ).toHaveTextContent(
				`selected ${ path }`
			)
		);
	} );

	it.each( [ true, false ] )(
		'opens the email folder of the menu site, running or not (%s)',
		async ( selectedRunning ) => {
			const { open, connector } = setup( { selectedRunning } );
			await open();
			fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Go to' } ) );
			fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Email' } ) );
			await waitFor( () =>
				expect( connector.openSiteEmailFolder ).toHaveBeenCalledExactlyOnceWith( 'selected' )
			);
			expect( connector.startSite ).not.toHaveBeenCalled();
		}
	);

	it( 'stops only other running sites', async () => {
		const { open, connector } = setup();
		await open();
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Stop' } ) );
		const item = await screen.findByRole( 'menuitem', { name: 'Stop other sites' } );
		await waitFor( () => expect( item ).not.toHaveAttribute( 'aria-disabled', 'true' ) );
		fireEvent.click( item );
		await waitFor( () => expect( connector.stopSite ).toHaveBeenCalledExactlyOnceWith( 'other' ) );
	} );

	it( 'refreshes running state before stopping and continues after a failure', async () => {
		const { open, connector, queryClient } = setup();
		await open();
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Stop' } ) );
		const item = await screen.findByRole( 'menuitem', { name: 'Stop other sites' } );
		await waitFor( () => expect( item ).not.toHaveAttribute( 'aria-disabled', 'true' ) );
		connector.state.sites = [
			makeSite( { id: 'selected', name: 'Selected', running: true } ),
			makeSite( { id: 'other', name: 'Other', running: false } ),
			makeSite( { id: 'new-running', name: 'New running', running: true } ),
			makeSite( { id: 'also-running', name: 'Also running', running: true } ),
		];
		connector.emit( 'onSiteEvent', {
			event: SITE_EVENTS.UPDATED,
			siteId: 'other',
			running: false,
		} );
		await waitFor( () =>
			expect( screen.getByRole( 'menuitem', { name: 'Stop other sites' } ) ).toBeInTheDocument()
		);
		await waitFor( () => expect( connector.getSites.mock.calls.length ).toBeGreaterThan( 1 ) );
		await waitFor( () => expect( queryClient.isFetching() ).toBe( 0 ) );
		connector.stopSite.mockRejectedValueOnce( new Error( 'Busy' ) );
		fireEvent.click( screen.getByRole( 'menuitem', { name: 'Stop other sites' } ) );
		await waitFor( () => expect( connector.stopSite ).toHaveBeenCalledTimes( 2 ) );
		expect( connector.stopSite ).toHaveBeenNthCalledWith( 1, 'new-running' );
		expect( connector.stopSite ).toHaveBeenNthCalledWith( 2, 'also-running' );
	} );

	it.each( [ false, true ] )(
		'hides the option for a stopped site in either menu (%s)',
		async ( contextMenu ) => {
			const { open, connector } = setup( { selectedRunning: false, contextMenu } );
			await open();
			await screen.findByRole( 'menuitem', { name: /Start site/ } );
			await waitFor( () => expect( connector.getSites ).toHaveBeenCalled() );
			expect(
				screen.queryByRole( 'menuitem', { name: 'Stop other sites' } )
			).not.toBeInTheDocument();
		}
	);

	it( 'hides the option when no other sites are running', async () => {
		const { open, connector } = setup( { otherRunning: false } );
		await open();
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Stop' } ) );
		await screen.findByRole( 'menuitem', { name: 'Settings' } );
		await waitFor( () => expect( connector.getSites ).toHaveBeenCalled() );
		expect(
			screen.queryByRole( 'menuitem', { name: 'Stop other sites' } )
		).not.toBeInTheDocument();
		expect( screen.queryByRole( 'menuitem', { name: 'Stop all sites' } ) ).not.toBeInTheDocument();
	} );
} );

it.each( [ false, true ] )(
	'stops all running sites from either submenu (%s)',
	async ( contextMenu ) => {
		const { open, connector } = setup( { contextMenu } );
		await open();
		expect( screen.queryByRole( 'menuitem', { name: 'Stop site' } ) ).not.toBeInTheDocument();
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Stop' } ) );
		const item = await screen.findByRole( 'menuitem', { name: 'Stop all sites' } );
		expect( item.closest( '[role="menu"]' )?.querySelector( '[role="separator"]' ) ).toBeNull();
		fireEvent.click( item );
		await waitFor( () => expect( connector.stopSite ).toHaveBeenCalledTimes( 2 ) );
		expect( connector.stopSite ).toHaveBeenCalledWith( 'selected' );
		expect( connector.stopSite ).toHaveBeenCalledWith( 'other' );
		expect( connector.stopSite ).not.toHaveBeenCalledWith( 'stopped' );
	}
);

describe( 'Restart site', () => {
	it.each( [ false, true ] )(
		'waits for stop before starting from either menu (%s)',
		async ( contextMenu ) => {
			const { open, connector } = setup( { contextMenu } );
			let finishStop!: () => void;
			connector.stopSite.mockImplementation(
				() =>
					new Promise( ( resolve ) => {
						finishStop = resolve;
					} )
			);
			await open();
			fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Restart site' } ) );
			await waitFor( () =>
				expect( connector.stopSite ).toHaveBeenCalledExactlyOnceWith( 'selected' )
			);
			expect( connector.startSite ).not.toHaveBeenCalled();
			finishStop();
			await waitFor( () =>
				expect( connector.startSite ).toHaveBeenCalledExactlyOnceWith( 'selected' )
			);
		}
	);

	it( 'does not start when stopping fails', async () => {
		const { open, connector } = setup();
		connector.stopSite.mockRejectedValueOnce( new Error( 'Unable to stop' ) );
		await open();
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Restart site' } ) );
		await waitFor( () => expect( connector.stopSite ).toHaveBeenCalled() );
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Site actions for Selected' } )
			).not.toHaveAttribute( 'aria-busy', 'true' )
		);
		expect( connector.startSite ).not.toHaveBeenCalled();
	} );

	it.each( [ false, true ] )( 'hides restart for a stopped site (%s)', async ( contextMenu ) => {
		const { open } = setup( { selectedRunning: false, contextMenu } );
		await open();
		await screen.findByRole( 'menuitem', { name: /Start site/ } );
		expect( screen.queryByRole( 'menuitem', { name: 'Restart site' } ) ).not.toBeInTheDocument();
	} );

	it( 'disables restart while the site is busy', async () => {
		const { open } = setup( { busy: true } );
		await open();
		expect( await screen.findByRole( 'menuitem', { name: 'Restart site' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
	} );
} );

describe( 'Remove site confirmation', () => {
	it( 'includes a generic preview warning without loading preview data, and passes the file choice', async () => {
		const { open, connector } = setup();
		await open();
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Delete site' } ) );
		expect(
			await screen.findByText( /delete its chats and any shared preview sites/ )
		).toBeVisible();
		fireEvent.click(
			screen.getByRole( 'checkbox', { name: 'Also move files and database to Trash' } )
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Remove site' } ) );
		await waitFor( () => expect( connector.deleteSite ).toHaveBeenCalledWith( 'selected', true ) );
		expect( connector.getSnapshots ).not.toHaveBeenCalled();
	} );
} );

const publishedWebsite = {
	id: 42,
	localSiteId: 'selected',
	url: 'https://example.com',
	syncSupport: 'syncable',
	lastPushTimestamp: '2026-10-19T14:00:00Z',
} as SyncSite;

it.each( [ false, true ] )(
	'opens publishing screens from either connected site menu (%s)',
	async ( contextMenu ) => {
		for ( const [ label, view ] of [
			[ 'Publish changes…', 'publish' ],
			[ 'Pull changes…', 'pull' ],
			[ 'Manage websites…', 'websites' ],
		] ) {
			const { open, requests } = setup( { contextMenu, connections: [ publishedWebsite ] } );
			await open();
			await waitFor( () =>
				expect( screen.getByRole( 'menuitem', { name: 'Publish' } ) ).toHaveAttribute(
					'aria-haspopup',
					'menu'
				)
			);
			fireEvent.click( screen.getByRole( 'menuitem', { name: 'Publish' } ) );
			fireEvent.click( await screen.findByRole( 'menuitem', { name: label } ) );
			expect( requests.publish ).toHaveBeenCalledExactlyOnceWith( {
				panel: 'publish',
				siteId: 'selected',
				view,
				remoteSiteId: 42,
			} );
			cleanup();
			unsubscribers.splice( 0 ).forEach( ( unsubscribe ) => unsubscribe() );
		}
	}
);

it( 'opens backups for the chosen destination and omits them for Pressable', async () => {
	const { open, connector } = setup( {
		connections: [
			publishedWebsite,
			{ ...publishedWebsite, id: 43, url: 'https://second.com', isPressable: true },
		],
	} );
	await open();
	await waitFor( () =>
		expect( screen.getByRole( 'menuitem', { name: 'Publish' } ) ).toHaveAttribute(
			'aria-haspopup',
			'menu'
		)
	);
	fireEvent.click( screen.getByRole( 'menuitem', { name: 'Publish' } ) );
	fireEvent.click( await screen.findByRole( 'menuitem', { name: 'second.com' } ) );
	await screen.findByRole( 'menuitem', { name: 'Publish changes…' } );
	expect( screen.queryByRole( 'menuitem', { name: 'View backups' } ) ).not.toBeInTheDocument();
	fireEvent.click( screen.getByRole( 'menuitem', { name: 'example.com' } ) );
	fireEvent.click( await screen.findByRole( 'menuitem', { name: 'View backups' } ) );
	expect( connector.openExternalUrl ).toHaveBeenCalledExactlyOnceWith(
		'https://wordpress.com/backup/example.com'
	);
} );
