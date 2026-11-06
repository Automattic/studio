import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getVisibleToasts, resetAppMessagesForTests, showToast } from '@/data/app-messages';
import { AppMessageCards, AppToasts, AppUpdateButton } from '@/features/notifications';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';

const isDescription = ( element: HTMLElement ) =>
	element.dataset.clamped !== undefined || element.dataset.expanded !== undefined;

beforeEach( () => {
	resetAppMessagesForTests();
	vi.stubGlobal( 'CSS', { supports: () => true } );
	vi.spyOn( HTMLElement.prototype, 'clientHeight', 'get' ).mockImplementation( function (
		this: HTMLElement
	) {
		return isDescription( this ) ? 20 : 0;
	} );
	vi.spyOn( HTMLElement.prototype, 'scrollHeight', 'get' ).mockImplementation( function (
		this: HTMLElement
	) {
		return isDescription( this ) ? 40 : 0;
	} );
} );
afterEach( () => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
} );

async function setup() {
	const view = renderWithProviders( <AppToasts /> );
	await screen.findByRole( 'region', { name: 'Notifications' } );
	return view;
}

describe( 'notification details', () => {
	it( 'toggles notification details with pointer and keyboard input', async () => {
		const onAction = vi.fn( () => new Promise< void >( () => {} ) );
		const title = 'Import needs attention';
		const description = 'Full details about the import';
		showToast( { title, description, action: { label: 'Retry', onClick: onAction } } );
		const { user } = await setup();
		const disclosure = await screen.findByRole( 'button', {
			name: `View notification: ${ title }`,
		} );
		const card = screen.getByText( title ).closest( '[role="presentation"]' )!;

		await user.click( screen.getByText( title ) );
		expect( disclosure ).toHaveAttribute( 'aria-expanded', 'true' );
		await user.click( screen.getByText( description ) );
		expect( disclosure ).toHaveAttribute( 'aria-expanded', 'false' );
		await user.click( card );
		expect( disclosure ).toHaveAttribute( 'aria-expanded', 'true' );
		act( () => disclosure.focus() );
		await user.keyboard( ' ' );
		expect( disclosure ).toHaveAttribute( 'aria-expanded', 'false' );
		await user.keyboard( '{Enter}' );
		expect( disclosure ).toHaveAttribute( 'aria-expanded', 'true' );

		await user.click( screen.getByRole( 'button', { name: 'Retry' } ) );
		expect( onAction ).toHaveBeenCalledOnce();
		expect( disclosure ).toHaveAttribute( 'aria-expanded', 'true' );
		await user.click( screen.getByRole( 'button', { name: `Dismiss ${ title }` } ) );
		expect( disclosure ).toHaveAttribute( 'aria-expanded', 'true' );
		await waitFor( () => expect( card ).not.toBeInTheDocument() );
	} );

	it( 'toggles a toast when swipe capture redirects the click to its container', async () => {
		showToast( { title: 'Import failed', description: 'Full error details' } );
		await setup();
		const notice = await screen.findByRole( 'dialog', { name: 'Import failed' } );
		const title = screen.getByText( 'Import failed' );
		const disclosure = screen.getByRole( 'button', { name: 'View notification: Import failed' } );

		for ( const expanded of [ 'true', 'false' ] ) {
			fireEvent.pointerDown( title, { button: 0, clientX: 50, clientY: 50 } );
			fireEvent.pointerUp( notice, { clientX: 51, clientY: 50 } );
			fireEvent.click( notice, { clientX: 51, clientY: 50, detail: 1 } );
			expect( disclosure ).toHaveAttribute( 'aria-expanded', expanded );
		}
	} );

	it( 'keeps toast details closed after an unfinished swipe returns to its starting point', async () => {
		showToast( { title: 'Import failed', description: 'Full error details' } );
		await setup();
		const notice = await screen.findByRole( 'dialog', { name: 'Import failed' } );
		const disclosure = screen.getByRole( 'button', { name: 'View notification: Import failed' } );

		fireEvent.pointerDown( screen.getByText( 'Import failed' ), {
			button: 0,
			clientX: 50,
			clientY: 50,
		} );
		fireEvent.pointerMove( notice, { clientX: 60, clientY: 50 } );
		fireEvent.pointerMove( notice, { clientX: 50, clientY: 50 } );
		fireEvent.pointerUp( notice, { clientX: 50, clientY: 50 } );
		fireEvent.click( notice, { clientX: 50, clientY: 50, detail: 1 } );

		expect( disclosure ).toHaveAttribute( 'aria-expanded', 'false' );
		expect( notice ).toBeVisible();
	} );

	it( 'keeps expanded notification text selectable', async () => {
		const description = 'Select these error details to copy them';
		showToast( { title: 'Import failed', description } );
		const { user } = await setup();
		const disclosure = await screen.findByRole( 'button', {
			name: 'View notification: Import failed',
		} );
		await user.click( disclosure );
		const details = screen.getByText( description );
		const selection = document.getSelection()!;
		const range = document.createRange();
		range.selectNodeContents( details );
		selection.removeAllRanges();
		selection.addRange( range );
		try {
			fireEvent.click( details );
			expect( selection.toString() ).toBe( description );
			expect( disclosure ).toHaveAttribute( 'aria-expanded', 'true' );
		} finally {
			selection.removeAllRanges();
		}
	} );

	it( 'shows fully visible descriptions without disclosure controls', async () => {
		vi.spyOn( HTMLElement.prototype, 'scrollHeight', 'get' ).mockReturnValue( 20 );
		showToast( { title: 'Operation failed', description: 'Origin not allowed', intent: 'error' } );
		await setup();
		expect( await screen.findByText( 'Origin not allowed' ) ).toBeVisible();
		expect(
			screen.queryByRole( 'button', { name: 'View notification: Operation failed' } )
		).not.toBeInTheDocument();
	} );

	it( 'shows notifications without descriptions as plain text', async () => {
		showToast( { title: 'Saved' } );
		await setup();
		expect( await screen.findByText( 'Saved' ) ).toBeVisible();
		expect(
			screen.queryByRole( 'button', { name: 'View notification: Saved' } )
		).not.toBeInTheDocument();
	} );

	it.each( [ undefined, 'Restart to finish updating.' ] )(
		'expands the original title without duplicating it (description: %s)',
		async ( description ) => {
			vi.spyOn( HTMLElement.prototype, 'scrollWidth', 'get' ).mockReturnValue( 500 );
			vi.spyOn( HTMLElement.prototype, 'clientWidth', 'get' ).mockReturnValue( 120 );
			const title = 'A long site name that does not fit on one line';
			showToast( { title, description } );
			await setup();
			expect( screen.queryByText( 'View details' ) ).not.toBeInTheDocument();
			const disclosure = await screen.findByRole( 'button', {
				name: `View notification: ${ title }`,
			} );
			expect( disclosure ).toHaveAttribute( 'aria-expanded', 'false' );
			fireEvent.click( disclosure );
			expect( disclosure ).toHaveAttribute( 'aria-expanded', 'true' );
			expect( screen.getAllByText( title ) ).toHaveLength( 1 );
			expect( screen.getByText( title ) ).toHaveAttribute( 'data-expanded', 'true' );
			fireEvent.click( disclosure );
			expect( disclosure ).toHaveAttribute( 'aria-expanded', 'false' );
			expect( screen.getByText( title ) ).not.toHaveAttribute( 'data-expanded' );
		}
	);

	it.each( [ false, true ] )(
		'keeps one error action in the header (primary action: %s)',
		async ( hasAction ) => {
			const title = 'Could not update';
			showToast( {
				title,
				intent: 'error',
				description: 'Update diagnostics',
				action: hasAction ? { label: 'Retry', onClick: vi.fn() } : undefined,
			} );
			await setup();
			const disclosure = await screen.findByRole( 'button', {
				name: `View notification: ${ title }`,
			} );
			fireEvent.click( disclosure );
			const action = screen.getByRole( 'button', {
				name: hasAction ? 'Retry' : 'Copy',
			} );
			expect( action.parentElement?.parentElement?.parentElement ).toContainElement(
				screen.getByText( title )
			);
			expect( screen.getAllByRole( 'button', { name: /^(Copy|Retry)$/ } ) ).toHaveLength( 1 );
		}
	);
} );

describe( 'sidebar cards', () => {
	it( 'shows a mount-time update failure once as a notice with its detail and retry action', async () => {
		const connector = createFakeConnector();
		const status = {
			state: 'error' as const,
			reason: 'generic' as const,
			currentVersion: '1.0.0',
			detail: 'The update could not be downloaded.',
		};
		connector.getAppUpdateStatus.mockResolvedValue( status );
		renderWithProviders(
			<>
				<aside aria-label="Sidebar notices">
					<AppMessageCards />
				</aside>
				<AppToasts />
			</>,
			{ connector }
		);
		await screen.findByText( 'Couldn’t update Studio' );
		expect( screen.getByText( status.detail ) ).toBeVisible();
		expect(
			screen.getByRole( 'complementary', { name: 'Sidebar notices' } )
		).toBeEmptyDOMElement();
		act( () => connector.emit( 'onAppUpdateStatusChanged', { ...status } ) );
		expect( getVisibleToasts().filter( ( notice ) => notice.id === 'app-update' ) ).toHaveLength(
			1
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Try again' } ) );
		await waitFor( () => expect( connector.checkForAppUpdates ).toHaveBeenCalledOnce() );
		expect( connector.openStudioLogs ).not.toHaveBeenCalled();
	} );

	it( 'replaces a processing update notice in place with a dismissible result', async () => {
		const connector = createFakeConnector();
		connector.getAppUpdateStatus.mockResolvedValue( {
			state: 'downloading',
			currentVersion: '1.0.0',
			newVersion: '1.1.0',
		} );
		const { queryClient } = renderWithProviders(
			<>
				<aside aria-label="Sidebar notices">
					<AppMessageCards />
				</aside>
				<AppUpdateButton />
				<AppToasts />
			</>,
			{ connector }
		);
		await screen.findByText( 'Downloading update' );
		expect( screen.getByText( 'Updating from 1.0.0 to 1.1.0.' ) ).toBeVisible();
		expect(
			screen.getByRole( 'complementary', { name: 'Sidebar notices' } )
		).toBeEmptyDOMElement();
		expect( screen.getByRole( 'button', { name: 'Dismiss Downloading update' } ) ).toBeVisible();
		expect( getVisibleToasts().find( ( notice ) => notice.id === 'app-update' ) ).toMatchObject( {
			processing: true,
			dismissible: true,
		} );
		expect( screen.queryByRole( 'button', { name: 'Update available' } ) ).not.toBeInTheDocument();
		act( () => {
			connector.emit( 'onAppUpdateStatusChanged', {
				state: 'ready',
				currentVersion: '1.0.0',
				newVersion: '1.1.0',
			} );
		} );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Restart to update' } ) );
		expect( screen.queryByText( 'Downloading update' ) ).not.toBeInTheDocument();
		expect( await screen.findByText( 'Update ready' ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Dismiss Update ready' } ) ).toBeVisible();
		expect( getVisibleToasts().filter( ( notice ) => notice.id === 'app-update' ) ).toHaveLength(
			1
		);
		expect(
			getVisibleToasts().find( ( notice ) => notice.id === 'app-update' )?.processing
		).not.toBe( true );
		expect( screen.queryByRole( 'button', { name: 'Restart' } ) ).not.toBeInTheDocument();
		await waitFor( () => expect( connector.installAppUpdate ).toHaveBeenCalledOnce() );

		act( () => {
			queryClient.setQueryData( [ 'app-update-status' ], {
				state: 'error',
				reason: 'generic',
				currentVersion: '1.0.0',
			} );
		} );
		await screen.findByText( 'Couldn’t update Studio' );
		expect(
			screen.getByRole( 'button', { name: 'Dismiss Couldn’t update Studio' } )
		).toBeVisible();
		expect(
			within( screen.getByRole( 'complementary', { name: 'Sidebar notices' } ) ).queryByText(
				'Couldn’t update Studio'
			)
		).not.toBeInTheDocument();
		const retryButtons = await screen.findAllByRole( 'button', { name: 'Try again' } );
		fireEvent.click( retryButtons[ 0 ] );
		await waitFor( () => expect( connector.checkForAppUpdates ).toHaveBeenCalledOnce() );
	} );

	it( 'keeps the update button available after progress is dismissed and restores the failure action', async () => {
		const connector = createFakeConnector(
			{},
			{
				getAppUpdateStatus: async () => ( {
					state: 'downloading',
					currentVersion: '2.0.0',
					newVersion: null,
				} ),
			}
		);
		renderWithProviders(
			<>
				<AppToasts />
				<AppUpdateButton />
			</>,
			{ connector }
		);
		fireEvent.click( await screen.findByRole( 'button', { name: 'Dismiss Downloading update' } ) );
		await waitFor( () =>
			expect( screen.queryByText( 'Downloading update' ) ).not.toBeInTheDocument()
		);
		expect( screen.getByRole( 'button', { name: 'Downloading update…' } ) ).toHaveAttribute(
			'aria-busy',
			'true'
		);
		act( () =>
			connector.emit( 'onAppUpdateStatusChanged', {
				state: 'downloading',
				currentVersion: '2.0.0',
				newVersion: '2.1.0',
			} )
		);
		expect( screen.queryByText( 'Downloading update' ) ).not.toBeInTheDocument();
		act( () =>
			connector.emit( 'onAppUpdateStatusChanged', {
				state: 'error',
				currentVersion: '2.0.0',
				reason: 'generic',
			} )
		);
		expect( await screen.findByText( 'Couldn’t update Studio' ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Try again' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Download update' } ) ).toBeVisible();
	} );

	it( 'updates the processing notice when the target version becomes known', async () => {
		const connector = createFakeConnector(
			{},
			{
				getAppUpdateStatus: async () => ( {
					state: 'downloading',
					currentVersion: '2.0.0',
					newVersion: null,
				} ),
			}
		);
		renderWithProviders( <AppToasts />, { connector } );
		expect( await screen.findByText( 'Updating from 2.0.0.' ) ).toBeVisible();
		act( () =>
			connector.emit( 'onAppUpdateStatusChanged', {
				state: 'downloading',
				currentVersion: '2.0.0',
				newVersion: '2.1.0',
			} )
		);
		expect( await screen.findByText( 'Updating from 2.0.0 to 2.1.0.' ) ).toBeVisible();
		expect( screen.getAllByText( 'Downloading update' ) ).toHaveLength( 1 );
		expect( getVisibleToasts().filter( ( notice ) => notice.id === 'app-update' ) ).toHaveLength(
			1
		);
	} );

	it( 'resolves processing when a later update check finds nothing to download', async () => {
		const connector = createFakeConnector(
			{},
			{
				getAppUpdateStatus: async () => ( {
					state: 'downloading',
					currentVersion: '2.0.0',
					newVersion: null,
				} ),
			}
		);
		renderWithProviders( <AppToasts />, { connector } );
		await screen.findByText( 'Downloading update' );
		act( () =>
			connector.emit( 'onAppUpdateStatusChanged', { state: 'checking', currentVersion: '2.0.0' } )
		);
		expect( await screen.findByText( 'Checking for updates…' ) ).toBeVisible();
		act( () =>
			connector.emit( 'onAppUpdateStatusChanged', { state: 'idle', currentVersion: '2.0.0' } )
		);
		await waitFor( () =>
			expect( screen.queryByText( 'Checking for updates…' ) ).not.toBeInTheDocument()
		);
		expect( screen.queryByText( 'Studio is up to date' ) ).not.toBeInTheDocument();
	} );
} );
