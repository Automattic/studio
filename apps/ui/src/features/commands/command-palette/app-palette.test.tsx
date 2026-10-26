import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppMessagesForTests } from '@/data/app-messages';
import { setCommandPaletteOpen } from '@/data/use-command-palette';
import {
	createFakeConnector,
	makeSession,
	makeSite,
	TEST_USER,
	type FakeConnectorState,
} from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { AiSessionSummary, SiteDetails } from '@/data/core';

const isApple = /Mac|iPhone|iPad/.test( navigator.platform );

function site( overrides: Partial< SiteDetails > = {} ) {
	return makeSite( { id: 'one', path: '/sites/my-site', ...overrides } );
}

function chat( overrides: Partial< AiSessionSummary > ) {
	return {
		summary: makeSession( {
			ownerSiteId: 'one',
			updatedAt: new Date().toISOString(),
			...overrides,
		} ),
		entries: [],
	};
}

function setup( {
	sites = [ site() ],
	signedIn = false,
	...state
}: { sites?: SiteDetails[]; signedIn?: boolean } & Partial< FakeConnectorState > = {} ) {
	const connector = createFakeConnector( {
		sites,
		user: signedIn ? TEST_USER : null,
		...state,
		preferences: {
			autoCollapseSites: false,
			...state.preferences,
		} as FakeConnectorState[ 'preferences' ],
	} );
	return renderApp( { connector } );
}

function pressK( target: Document | Element = document ) {
	fireEvent.keyDown( target, { code: 'KeyK', key: 'k', metaKey: isApple, ctrlKey: ! isApple } );
}

async function search( query: string ) {
	pressK();
	fireEvent.change( await screen.findByLabelText( 'Search commands' ), {
		target: { value: query },
	} );
}

async function paletteCommand( query: string, name?: RegExp ) {
	await search( query );
	fireEvent.click(
		await screen.findByRole( 'option', { name: name ?? new RegExp( `^${ query }` ) } )
	);
	await waitFor( () =>
		expect( screen.queryByLabelText( 'Search commands' ) ).not.toBeInTheDocument()
	);
}

beforeEach( () => {
	localStorage.clear();
	resetAppMessagesForTests();
} );

afterEach( () => {
	act( () => {
		setCommandPaletteOpen( false );
	} );
} );

describe( 'Command palette in the Studio workspace', () => {
	it.each( [ false, true ] )(
		'restarts through the palette after stop settles (fails: %s)',
		async ( fails ) => {
			const { connector } = setup( { sites: [ site( { running: true } ) ] } );
			let finishStop!: () => void;
			connector.stopSite.mockImplementation(
				() =>
					new Promise< void >( ( resolve, reject ) => {
						finishStop = () => ( fails ? reject( new Error( 'Unable to stop' ) ) : resolve() );
					} )
			);
			await screen.findByRole( 'button', { name: 'Site actions for My site' } );
			await paletteCommand( 'Restart site' );
			await waitFor( () => expect( connector.stopSite ).toHaveBeenCalledExactlyOnceWith( 'one' ) );
			expect( connector.startSite ).not.toHaveBeenCalled();
			await act( async () => finishStop() );
			if ( fails ) {
				await screen.findAllByText( 'Failed to stop site' );
				expect( connector.startSite ).not.toHaveBeenCalled();
			} else {
				await waitFor( () =>
					expect( connector.startSite ).toHaveBeenCalledExactlyOnceWith( 'one' )
				);
			}
		}
	);

	it( 'switches sites and starts the selected site from the command palette', async () => {
		const { connector } = setup( {
			sites: [ site(), site( { id: 'two', name: 'Second site' } ) ],
		} );
		await screen.findByRole( 'button', { name: 'Site actions for My site' } );
		await search( 'Second site' );
		fireEvent.click( await screen.findByRole( 'option', { name: 'Second site' } ) );
		expect(
			await screen.findByRole( 'button', { name: 'Site actions for Second site' } )
		).toBeVisible();
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		await search( 'Start site' );
		fireEvent.click( await screen.findByRole( 'option', { name: 'Start site Second site' } ) );
		await waitFor( () => expect( connector.startSite ).toHaveBeenCalledWith( 'two' ) );
	} );

	it( 'opens a recent chat from the command palette on its owning site', async () => {
		const recent = chat( {
			id: 'recent-chat',
			title: 'Build a portfolio',
			ownerSiteId: 'two',
			updatedAt: '2026-10-11T12:00:00Z',
		} );
		const { connector, history } = setup( {
			sites: [ site(), site( { id: 'two', name: 'Second site' } ) ],
			signedIn: true,
			sessions: [
				recent,
				chat( { id: 'archived', title: 'Archived chat', ownerSiteId: 'two', archived: true } ),
				chat( { id: 'missing', title: 'Missing site chat', ownerSiteId: 'missing' } ),
			],
		} );
		await waitFor( () => expect( history.location.pathname ).toMatch( /^\/sessions\// ) );
		pressK();
		const recentGroup = await screen.findByRole( 'group', { name: 'Recent' } );
		expect(
			within( recentGroup ).queryByRole( 'option', { name: /Archived|Missing/ } )
		).not.toBeInTheDocument();
		fireEvent.click(
			within( recentGroup ).getByRole( 'option', { name: 'Build a portfolio Second site' } )
		);
		await waitFor( () => expect( connector.getSession ).toHaveBeenCalledWith( 'recent-chat' ) );
		expect( history.location.pathname ).toBe( '/sessions/recent-chat' );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
	} );

	it.each( [ false, true ] )(
		'switches Add site to the command palette (empty: %s)',
		async ( empty ) => {
			setup( { sites: empty ? [] : [ site() ] } );
			if ( ! empty ) {
				await screen.findByRole( 'button', { name: 'Site actions for My site' } );
				fireEvent.click( screen.getByRole( 'button', { name: 'Add site' } ) );
			}
			const dialog = await screen.findByRole( 'dialog', { name: 'Add site' } );
			const blank = await within( dialog ).findByRole( 'button', {
				name: 'Start with Blank site',
			} );
			await waitFor( () => expect( blank ).toHaveFocus() );
			pressK( blank );
			await waitFor( () =>
				expect( screen.queryByRole( 'dialog', { name: 'Add site' } ) ).not.toBeInTheDocument()
			);
			await waitFor( () => expect( screen.getByLabelText( 'Search commands' ) ).toHaveFocus() );
			fireEvent.change( screen.getByLabelText( 'Search commands' ), { target: { value: 'add' } } );
			fireEvent.click( await screen.findByRole( 'option', { name: 'New site' } ) );
			expect( await screen.findByRole( 'dialog', { name: 'Add site' } ) ).toBeVisible();
			await waitFor( () =>
				expect( screen.getByRole( 'button', { name: 'Start with Blank site' } ) ).toHaveFocus()
			);
			expect( screen.queryByRole( 'tooltip', { name: 'New site' } ) ).not.toBeInTheDocument();
		}
	);

	it( 'opens settings from the command palette at the matching field', async () => {
		setup();
		await screen.findByRole( 'button', { name: 'Site actions for My site' } );
		await search( 'Language' );
		fireEvent.click( await screen.findByRole( 'option', { name: 'Language General' } ) );
		expect( await screen.findByRole( 'dialog', { name: 'Settings' } ) ).toBeVisible();
		await waitFor( () =>
			expect(
				screen
					.getByText( 'Language', { selector: '[data-slot="field-label"]' } )
					.closest( '[data-settings-row]' )
			).toHaveAttribute( 'data-settings-match' )
		);
	} );

	it( 'uses existing host actions and preferences from the command palette', async () => {
		const { connector } = setup();
		await screen.findByRole( 'button', { name: 'Site actions for My site' } );
		await search( 'Open in Finder' );
		fireEvent.click( await screen.findByRole( 'option', { name: 'Open in Finder My site' } ) );
		expect( connector.openSiteFolder ).toHaveBeenCalledWith( 'one' );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		await search( 'dark mode' );
		await waitFor( () =>
			expect( screen.getByRole( 'option', { name: 'Use dark mode' } ) ).toHaveAttribute(
				'aria-selected',
				'true'
			)
		);
		fireEvent.keyDown( screen.getByLabelText( 'Search commands' ), { key: 'Enter' } );
		await waitFor( () =>
			expect( connector.setUserPreferences ).toHaveBeenCalledWith(
				{ colorScheme: 'dark' },
				undefined
			)
		);
	} );

	it( 'executes palette site actions once and reuses import confirmation', async () => {
		const { connector } = setup( {
			sites: [
				site( { running: true, customDomain: 'my-site.local', enableHttps: true } ),
				site( { id: 'two', running: true } ),
			],
		} );
		connector.exportFullSite.mockResolvedValue( '/tmp/site.zip' as never );
		connector.exportDatabase.mockResolvedValue( '/tmp/database.sql' as never );
		connector.copySite.mockResolvedValue( site( { id: 'copy', name: 'Copy' } ) );
		await screen.findByRole( 'button', { name: 'Site actions for My site' } );
		await paletteCommand( 'copy site URL', /^Copy site URL/ );
		expect( connector.copyText ).toHaveBeenCalledExactlyOnceWith( 'https://my-site.local' );
		await paletteCommand( 'open in browser', /^Open in Browser My site/ );
		expect( connector.openSiteUrl ).toHaveBeenCalledExactlyOnceWith( 'one', '/', {
			autoLogin: false,
		} );
		await paletteCommand( 'export entire site', /^Export entire site/ );
		await waitFor( () =>
			expect( connector.exportFullSite ).toHaveBeenCalledExactlyOnceWith( 'one' )
		);
		await paletteCommand( 'export database', /^Export database/ );
		await waitFor( () =>
			expect( connector.exportDatabase ).toHaveBeenCalledExactlyOnceWith( 'one' )
		);
		await paletteCommand( 'duplicate site', /^Duplicate site/ );
		await waitFor( () => expect( connector.copySite ).toHaveBeenCalledExactlyOnceWith( 'one' ) );
		await paletteCommand( 'stop other sites', /^Stop other sites/ );
		await waitFor( () => expect( connector.stopSite ).toHaveBeenCalledExactlyOnceWith( 'two' ) );
		const picker = vi.spyOn( HTMLInputElement.prototype, 'click' );
		await paletteCommand( 'import backup', /^Import backup/ );
		expect( picker ).toHaveBeenCalledTimes( 1 );
		const input = picker.mock.contexts[ 0 ] as HTMLInputElement;
		expect( input ).toHaveAttribute( 'type', 'file' );
		fireEvent.change( input, { target: { files: [ new File( [ 'backup' ], 'backup.zip' ) ] } } );
		const confirmation = await screen.findByRole( 'alertdialog', { name: /Overwrite/ } );
		expect( connector.importSiteFromBackup ).not.toHaveBeenCalled();
		fireEvent.click( within( confirmation ).getByRole( 'button', { name: 'Cancel' } ) );
		expect( connector.importSiteFromBackup ).not.toHaveBeenCalled();
		await paletteCommand( 'reset appearance', /^Reset appearance tint/ );
		await waitFor( () =>
			expect( connector.setUserPreferences ).toHaveBeenCalledExactlyOnceWith(
				{ accentColor: '#3858e9', tintIntensity: 0, contrast: 0 },
				undefined
			)
		);
	} );

	it( 'pins, renames and archives the current chat through palette commands', async () => {
		const { connector, history } = setup( {
			sites: [ site( { running: true } ) ],
			signedIn: true,
			sessions: [ chat( { id: 'palette-chat', title: 'Working chat' } ) ],
		} );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sessions/palette-chat' ) );
		await paletteCommand( 'Working chat', /^Working chat/ );
		await waitFor( () => expect( connector.getSession ).toHaveBeenCalledWith( 'palette-chat' ) );
		await paletteCommand( 'pin chat', /^Pin chat/ );
		await screen.findByRole( 'group', { name: 'Pinned' } );
		await waitFor( () =>
			expect( connector.state.preferences.sidebarPins ).toContain( 'chat:palette-chat' )
		);
		await paletteCommand( 'rename chat', /^Rename chat/ );
		const dialog = await screen.findByRole( 'dialog', { name: 'Rename chat' } );
		fireEvent.change( within( dialog ).getByRole( 'textbox', { name: 'Chat title' } ), {
			target: { value: 'Updated chat' },
		} );
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Save' } ) );
		await waitFor( () =>
			expect( connector.updateSessionMetadata ).toHaveBeenCalledWith( 'palette-chat', {
				title: 'Updated chat',
			} )
		);
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		await paletteCommand( 'archive chat', /^Archive chat/ );
		await waitFor( () =>
			expect( connector.updateSessionMetadata ).toHaveBeenCalledWith( 'palette-chat', {
				archived: true,
			} )
		);
		await waitFor( () =>
			expect( screen.queryByRole( 'group', { name: 'Pinned' } ) ).not.toBeInTheDocument()
		);
	} );

	it( 'opens Intensity settings from the palette and focuses its slider', async () => {
		setup();
		await screen.findByRole( 'button', { name: 'Site actions for My site' } );
		await search( 'Intensity' );
		fireEvent.click( await screen.findByRole( 'option', { name: 'Intensity Appearance' } ) );
		await screen.findByRole( 'dialog', { name: 'Settings' } );
		await waitFor( () =>
			expect( screen.getByLabelText( 'Intensity', { selector: 'input' } ) ).toHaveFocus()
		);
	} );

	it( 'replays What’s New from the palette and marks it seen when skipped', async () => {
		const { connector } = setup();
		await screen.findByRole( 'button', { name: 'Site actions for My site' } );
		await paletteCommand( 'new features', /^What’s New/ );
		expect(
			await screen.findByRole( 'dialog', { name: 'Meet the new WordPress Studio' } )
		).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Skip' } ) );
		await waitFor( () =>
			expect( connector.setOnboardingHints ).toHaveBeenCalledWith(
				expect.objectContaining( { whatsNewSeenVersion: expect.any( Number ) } )
			)
		);
	} );

	it.each( [ 'light', 'dark' ] as const )(
		'toggles from the rendered %s theme with one palette command',
		async ( scheme ) => {
			const { connector } = setup( { preferences: { colorScheme: scheme } as never } );
			await screen.findByRole( 'button', { name: 'Site actions for My site' } );
			await search( scheme + ' mode' );
			fireEvent.keyDown( screen.getByLabelText( 'Search commands' ), { key: 'Enter' } );
			await waitFor( () =>
				expect( connector.setUserPreferences ).toHaveBeenCalledExactlyOnceWith(
					{ colorScheme: scheme === 'dark' ? 'light' : 'dark' },
					undefined
				)
			);
		}
	);
} );
