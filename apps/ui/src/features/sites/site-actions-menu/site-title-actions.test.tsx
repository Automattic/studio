import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getNoticeHistory, resetAppMessagesForTests } from '@/data/app-messages';
import { createFakeConnector, makeSession, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { Connector, SiteDetails } from '@/data/core';

const SHORTCUTS = /Ctrl\+Alt\+[PRS]|⌥⌘[PRS]|Ctrl\+Shift\+A|⇧⌘A/g;

const site = ( overrides: Partial< SiteDetails > = {} ) =>
	makeSite( { id: 'one', name: 'My site', path: '/sites/my-site', ...overrides } );

function setup( sites: SiteDetails[] = [ site() ], overrides: Partial< Connector > = {} ) {
	const connector = createFakeConnector(
		{
			sites,
			sessions: sites.map( ( item ) => ( {
				summary: makeSession( {
					id: `${ item.id }-chat`,
					title: `${ item.name } chat`,
					ownerSiteId: item.id,
					ownerSitePath: item.path,
				} ),
				entries: [],
			} ) ),
		},
		overrides
	);
	return renderApp( { connector, path: `/sites/${ sites[ 0 ].id }` } );
}

const menuItems = async () =>
	within( await screen.findByRole( 'menu' ) )
		.getAllByRole( 'menuitem' )
		.map( ( item ) => item.textContent?.replace( SHORTCUTS, '' ) );

beforeEach( () => {
	localStorage.clear();
	resetAppMessagesForTests();
} );

afterEach( () => vi.restoreAllMocks() );

describe( 'sidebar site menu', () => {
	it( 'shows the same site actions from the title and sidebar context menu', async () => {
		setup();
		fireEvent.click( await screen.findByRole( 'button', { name: 'Site actions for My site' } ) );
		const titleItems = await menuItems();
		fireEvent.keyDown( screen.getByRole( 'menu' ), { key: 'Escape' } );
		await waitFor( () => expect( screen.queryByRole( 'menu' ) ).not.toBeInTheDocument() );
		fireEvent.contextMenu( screen.getByRole( 'button', { name: 'My site' } ) );
		expect( await menuItems() ).toEqual( titleItems );
	} );

	it( 'uses the same submenus and delete confirmation for a sidebar site', async () => {
		const { connector } = setup( [
			site(),
			site( { id: 'other', name: 'Other site', path: '/sites/other' } ),
		] );
		await screen.findByRole( 'button', { name: 'Site actions for My site' } );
		const row = screen.getByRole( 'button', { name: 'Other site' } );
		fireEvent.contextMenu( row );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Open in' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Finder' } ) );
		await waitFor( () => expect( connector.openSiteFolder ).toHaveBeenCalledWith( 'other' ) );
		await waitFor( () => expect( screen.queryByRole( 'menu' ) ).not.toBeInTheDocument() );
		fireEvent.contextMenu( row );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Delete site' } ) );
		const dialog = await screen.findByRole( 'alertdialog', {
			name: 'Remove “Other site” from WordPress Studio?',
		} );
		expect( connector.deleteSite ).not.toHaveBeenCalled();
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Remove site' } ) );
		await waitFor( () => expect( connector.deleteSite ).toHaveBeenCalledWith( 'other', false ) );
	} );
} );

describe( 'site title actions', () => {
	it.each( [ [ 'phpMyAdmin', '/phpmyadmin/index.php?route=/database/structure&db=wordpress' ] ] )(
		'starts a stopped site before opening %s',
		async ( label, path ) => {
			let finishStart!: () => void;
			const { connector } = setup( [ site() ], {
				startSite: () =>
					new Promise( ( resolve ) => {
						finishStart = resolve;
					} ),
			} );
			fireEvent.click( await screen.findByRole( 'button', { name: 'Site actions for My site' } ) );
			fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Open in' } ) );
			fireEvent.click( await screen.findByRole( 'menuitem', { name: label } ) );
			await waitFor( () => expect( connector.startSite ).toHaveBeenCalledWith( 'one' ) );
			expect( connector.openSiteUrl ).not.toHaveBeenCalled();
			await act( async () => finishStart() );
			await waitFor( () => expect( connector.openSiteUrl ).toHaveBeenCalledWith( 'one', path ) );
		}
	);

	it( 'does not open a destination when starting fails', async () => {
		const { connector } = setup();
		connector.startSite.mockRejectedValueOnce( new Error( 'Start failed' ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Site actions for My site' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Open in' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'phpMyAdmin' } ) );
		await screen.findAllByText( 'Start failed' );
		expect( connector.openSiteUrl ).not.toHaveBeenCalled();
	} );

	it( 'opens the configured editor', async () => {
		const { connector } = setup();
		fireEvent.click( await screen.findByRole( 'button', { name: 'Site actions for My site' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Open in' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Visual Studio Code' } ) );
		await waitFor( () => expect( connector.openSiteInEditor ).toHaveBeenCalledWith( 'one' ) );
	} );

	it( 'confirms a backup import before touching the site and permits cancellation', async () => {
		const { connector, container } = setup( [ site( { id: 'backup', path: '/sites/backup' } ) ], {
			getFilePath: async () => '/tmp/backup.zip',
		} );
		await screen.findByRole( 'button', { name: 'Site actions for My site' } );
		const input = container.querySelector( 'input[type="file"][hidden]' )!;
		const file = new File( [ 'backup' ], 'backup.zip' );
		fireEvent.change( input, { target: { files: [ file ] } } );
		let dialog = await screen.findByRole( 'alertdialog', { name: 'Overwrite My site?' } );
		expect( connector.getFilePath ).not.toHaveBeenCalled();
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Cancel' } ) );
		expect( connector.importSiteFromBackup ).not.toHaveBeenCalled();
		fireEvent.change( input, { target: { files: [ file ] } } );
		dialog = await screen.findByRole( 'alertdialog', { name: 'Overwrite My site?' } );
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Import' } ) );
		await waitFor( () =>
			expect( connector.importSiteFromBackup ).toHaveBeenCalledWith(
				'backup',
				'/tmp/backup.zip',
				expect.anything()
			)
		);
		expect( await screen.findByText( 'Import finished', {}, { timeout: 5000 } ) ).toBeVisible();
	} );

	it( 'stops the selected running site from its title menu', async () => {
		const { connector } = setup( [ site( { running: true } ) ] );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Site actions for My site' } ) );
		expect( screen.queryByRole( 'menuitem', { name: /^Start site/ } ) ).not.toBeInTheDocument();
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Stop' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Stop site' } ) );
		await waitFor( () => expect( connector.stopSite ).toHaveBeenCalledWith( 'one' ) );
	} );

	it( 'requires confirmation and preserves files by default when deleting', async () => {
		const { connector } = setup();
		fireEvent.click( await screen.findByRole( 'button', { name: 'Site actions for My site' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Delete site' } ) );
		const dialog = await screen.findByRole( 'alertdialog' );
		expect( connector.deleteSite ).not.toHaveBeenCalled();
		expect( within( dialog ).getByRole( 'checkbox' ) ).not.toBeChecked();
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Remove site' } ) );
		await waitFor( () => expect( connector.deleteSite ).toHaveBeenCalledWith( 'one', false ) );
	} );

	it( 'stays open with the reason when deleting fails, and resets Trash on reopening', async () => {
		const { connector } = setup();
		connector.deleteSite.mockRejectedValueOnce( new Error( 'Site is running' ) );
		const openDelete = async () => {
			fireEvent.click( await screen.findByRole( 'button', { name: 'Site actions for My site' } ) );
			fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Delete site' } ) );
			return screen.findByRole( 'alertdialog' );
		};
		let dialog = await openDelete();
		fireEvent.click( within( dialog ).getByRole( 'checkbox' ) );
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Remove site' } ) );
		expect( await within( dialog ).findByText( 'Site is running' ) ).toBeVisible();
		expect( connector.deleteSite ).toHaveBeenCalledWith( 'one', true );
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Cancel' } ) );
		await waitFor( () => expect( screen.queryByRole( 'alertdialog' ) ).not.toBeInTheDocument() );
		dialog = await openDelete();
		expect( within( dialog ).getByRole( 'checkbox' ) ).not.toBeChecked();
	} );

	it( 'holds off Delete, saying why, while one of the site’s chats is running', async () => {
		setup( [ site() ], {
			getActiveAgentRuns: async () => [
				{ sessionId: 'one-chat', phase: 'running', runId: 'run', startedAt: Date.now() },
			],
		} );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Site actions for My site' } ) );
		await waitFor( () =>
			expect( screen.getByRole( 'menuitem', { name: /^Delete site/ } ) ).toHaveAttribute(
				'aria-disabled',
				'true'
			)
		);
		expect(
			screen.getByText( 'Wait for active chats and queued prompts to finish.' )
		).toBeInTheDocument();
	} );

	it( 'tells the user when a destination cannot open', async () => {
		vi.spyOn( console, 'error' ).mockImplementation( () => undefined );
		const { connector } = setup();
		connector.openSiteInTerminal.mockRejectedValueOnce( new Error( 'Terminal unavailable' ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Site actions for My site' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Open in' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Terminal' } ) );
		expect( await screen.findByText( 'Couldn’t open Terminal' ) ).toBeVisible();
		expect( screen.getByText( 'Terminal unavailable' ) ).toBeVisible();
	} );

	it( 'leaves out the editor when none is preferred or installed', async () => {
		const connector = createFakeConnector(
			{ sites: [ site() ], preferences: { editor: undefined } },
			{
				getInstalledApps: async () =>
					( { terminal: true } ) as Awaited< ReturnType< Connector[ 'getInstalledApps' ] > >,
			}
		);
		renderApp( { connector, path: '/sites/one' } );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Site actions for My site' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Open in' } ) );
		expect( await screen.findByRole( 'menuitem', { name: 'Terminal' } ) ).toBeVisible();
		expect(
			screen.queryByRole( 'menuitem', { name: 'Visual Studio Code' } )
		).not.toBeInTheDocument();
	} );

	it( 'keeps duplication progress out of notifications and records its failure once', async () => {
		let rejectCopy!: ( error: Error ) => void;
		setup( [ site() ], {
			copySite: () =>
				new Promise( ( _resolve, reject ) => {
					rejectCopy = reject;
				} ),
		} );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Site actions for My site' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: /^Duplicate$/ } ) );
		await waitFor( () => expect( rejectCopy ).toBeDefined() );
		expect( getNoticeHistory() ).toHaveLength( 0 );
		expect( screen.getByRole( 'button', { name: 'Site actions for My site' } ) ).toBeEnabled();
		act( () => rejectCopy( new Error( 'Copy failed' ) ) );
		await screen.findByText( 'Failed to copy site' );
		expect( getNoticeHistory() ).toHaveLength( 1 );
		expect( getNoticeHistory()[ 0 ].intent ).toBe( 'error' );
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'Site actions for My site' } ) ).toBeEnabled()
		);
	} );

	it( 'opens the duplicate only when its completion action is chosen', async () => {
		const { connector } = setup();
		connector.copySite.mockImplementation( async () => {
			const copy = site( { id: 'copy', name: 'My site copy', path: '/sites/copy' } );
			connector.state.sites = [ ...connector.state.sites, copy ];
			return copy;
		} );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Site actions for My site' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: /^Duplicate$/ } ) );
		await waitFor( () => expect( connector.copySite ).toHaveBeenCalledWith( 'one' ) );
		await screen.findByRole( 'button', { name: 'Open site' } );
		expect( screen.getByRole( 'button', { name: 'Site actions for My site' } ) ).toBeVisible();
		expect( getNoticeHistory() ).toHaveLength( 1 );
		fireEvent.click( screen.getByRole( 'button', { name: 'Open site' } ) );
		expect(
			await screen.findByRole( 'button', { name: 'Site actions for My site copy' } )
		).toBeVisible();
	} );
} );
