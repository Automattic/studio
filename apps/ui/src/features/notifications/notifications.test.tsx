import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getNoticeHistory, resetAppMessagesForTests, showToast } from '@/data/app-messages';
import { AppToasts, NoticeHistoryButton } from '@/features/notifications';
import { closeNoticeHistory, openNoticeHistory } from '@/features/notifications/notice-history';
import { renderWithProviders } from '@/test/render';

const isDescription = ( element: HTMLElement ) =>
	element.dataset.clamped !== undefined || element.dataset.expanded !== undefined;

beforeEach( () => {
	resetAppMessagesForTests();
	closeNoticeHistory();
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

async function setup( withToasts = false ) {
	const view = renderWithProviders(
		<>
			<NoticeHistoryButton />
			{ withToasts && <AppToasts /> }
		</>
	);
	await screen.findByRole( 'button', { name: /Notification history/ } );
	return view;
}

const bell = () => screen.getByRole( 'button', { name: /Notification history/ } );
const hasDot = () => bell().getAttribute( 'aria-label' )?.includes( 'notifications available' );

describe( 'notifications popover', () => {
	it( 'places actions beside the expandable summary and outside its button', async () => {
		showToast( {
			title: 'A very long notification title',
			description: 'Expandable description',
			action: { label: 'Open', onClick: vi.fn() },
		} );
		await setup();
		fireEvent.click( await screen.findByRole( 'button', { name: /Notification history/ } ) );
		const summary = await screen.findByRole( 'button', {
			name: 'View notification: A very long notification title',
		} );
		const action = screen.getByRole( 'button', { name: 'Open' } );
		expect( action.closest( 'li' ) ).toBe( summary.closest( 'li' ) );
		expect( within( summary ).queryByRole( 'button' ) ).not.toBeInTheDocument();
		expect( within( summary.closest( 'li' )! ).getByText( 'Just now' ) ).toBeVisible();
		fireEvent.click( action );
		expect( summary ).toHaveAttribute( 'aria-expanded', 'false' );
	} );

	it( 'shares a pending Undo between the toast and history and removes it after completion', async () => {
		let finish!: () => void;
		const onClick = vi.fn( () => new Promise< void >( ( resolve ) => ( finish = resolve ) ) );
		await setup( true );
		act( () => {
			showToast( { title: 'Chat archived', action: { label: 'Undo', once: true, onClick } } );
		} );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Undo' } ) );
		expect( screen.getByRole( 'button', { name: 'Undo' } ) ).toBeDisabled();
		fireEvent.click( bell() );
		const history = await screen.findByRole( 'dialog', { name: 'Notification history' } );
		expect( within( history ).getByRole( 'button', { name: 'Undo' } ) ).toBeDisabled();
		await act( async () => finish() );
		expect( within( history ).queryByRole( 'button', { name: 'Undo' } ) ).not.toBeInTheDocument();
		expect( within( history ).getByText( 'Chat archived' ) ).toBeVisible();
		expect( onClick ).toHaveBeenCalledOnce();
	} );

	it( 'shows fully visible descriptions without disclosure controls', async () => {
		vi.spyOn( HTMLElement.prototype, 'scrollHeight', 'get' ).mockReturnValue( 20 );
		showToast( { title: 'Operation failed', description: 'Origin not allowed', intent: 'error' } );
		await setup();
		fireEvent.click( bell() );
		expect( await screen.findByText( 'Origin not allowed' ) ).toBeVisible();
		expect(
			screen.queryByRole( 'button', { name: 'View notification: Operation failed' } )
		).not.toBeInTheDocument();
	} );

	it( 'shows notifications without descriptions as plain text', async () => {
		showToast( { title: 'Saved' } );
		await setup();
		fireEvent.click( bell() );
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
			fireEvent.click( bell() );
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
			fireEvent.click( bell() );
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

	it( 'closes with Escape and returns focus to the bell', async () => {
		await setup();
		bell().focus();
		fireEvent.click( bell() );
		await screen.findByText( 'No notifications.' );
		fireEvent.keyDown( screen.getByRole( 'dialog' ), { key: 'Escape' } );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		await waitFor( () => expect( bell() ).toHaveFocus() );
	} );

	it( 'opens details in place from the toast summary', async () => {
		await setup( true );
		act( () => {
			showToast( {
				title: 'Import failed',
				intent: 'error',
				description: 'Details about the failure',
			} );
		} );
		expect( await screen.findByText( 'Details about the failure' ) ).toBeVisible();
		const summary = screen.getByRole( 'button', { name: 'View notification: Import failed' } );
		expect( summary ).toHaveAttribute( 'aria-expanded', 'false' );
		fireEvent.click( summary );
		expect( summary ).toHaveAttribute( 'aria-expanded', 'true' );
		expect(
			screen.queryByRole( 'dialog', { name: 'Notification history' } )
		).not.toBeInTheDocument();
		expect( getNoticeHistory() ).toHaveLength( 1 );
		expect( screen.getByRole( 'button', { name: 'Dismiss Import failed' } ) ).toBeVisible();
		fireEvent.click( summary );
		expect( summary ).toHaveAttribute( 'aria-expanded', 'false' );
	} );

	it( 'expands the same details in a toast and its history card', async () => {
		await setup( true );
		act( () => {
			showToast( { title: 'Import failed', description: 'Full error details', intent: 'error' } );
		} );
		fireEvent.click(
			await screen.findByRole( 'button', { name: 'View notification: Import failed' } )
		);
		expect( screen.getByText( 'Full error details' ) ).toBeVisible();
		expect( screen.queryByText( 'Just now' ) ).not.toBeInTheDocument();
		fireEvent.click( bell() );
		const history = await screen.findByRole( 'dialog', { name: 'Notification history' } );
		fireEvent.click(
			within( history ).getByRole( 'button', { name: 'View notification: Import failed' } )
		);
		expect( within( history ).getByText( 'Full error details' ) ).toBeVisible();
		expect( within( history ).getByText( 'Just now' ) ).toBeVisible();
	} );

	it( 'retains actions after the banner is dismissed and omits empty details', async () => {
		const onClick = vi.fn();
		await setup( true );
		act(
			() =>
				void showToast( {
					title: 'Site duplicated: Portfolio',
					action: { label: 'Open', onClick },
				} )
		);
		expect( screen.queryByRole( 'button', { name: 'Details' } ) ).not.toBeInTheDocument();
		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Dismiss Site duplicated: Portfolio' } )
		);
		fireEvent.click( bell() );
		const dialog = await screen.findByRole( 'dialog', { name: 'Notification history' } );
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Open' } ) );
		await waitFor( () => expect( onClick ).toHaveBeenCalledOnce() );
		await waitFor( () =>
			expect(
				screen.queryByRole( 'dialog', { name: 'Notification history' } )
			).not.toBeInTheDocument()
		);
	} );

	it( 'shows the dot for arrivals while history is open and keeps it after closing', async () => {
		await setup();
		expect( hasDot() ).toBe( false );
		fireEvent.click( bell() );
		await screen.findByText( 'No notifications.' );
		act( () => {
			showToast( { title: 'First result' } );
		} );
		await screen.findByText( 'First result' );
		expect( hasDot() ).toBe( true );
		fireEvent.keyDown( screen.getByRole( 'dialog' ), { key: 'Escape' } );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		expect( hasDot() ).toBe( true );
		act( () => {
			showToast( { title: 'Second result' } );
		} );
		expect( hasDot() ).toBe( true );
	} );

	it( 'keeps the dot while notifications remain and removes it after clearing all', async () => {
		showToast( { title: 'Site started' } );
		showToast( { title: 'Site stopped' } );
		await setup();
		expect( hasDot() ).toBe( true );
		fireEvent.click( bell() );
		await screen.findByText( 'Site started' );
		expect( hasDot() ).toBe( true );
		expect( getNoticeHistory() ).toHaveLength( 2 );
		fireEvent.click( screen.getByRole( 'button', { name: 'Dismiss Site started' } ) );
		expect( getNoticeHistory() ).toHaveLength( 1 );
		expect( hasDot() ).toBe( true );
		expect( screen.getByRole( 'dialog', { name: 'Notification history' } ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Clear all' } ) );
		expect( screen.queryByText( 'No notifications.' ) ).not.toBeInTheDocument();
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		expect( getNoticeHistory() ).toHaveLength( 0 );
		expect( hasDot() ).toBe( false );
	} );

	it( 'closes after dismissing the last notification and allows reopening the empty list', async () => {
		showToast( { title: 'Import failed', intent: 'error' } );
		await setup();
		fireEvent.click( bell() );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Dismiss Import failed' } ) );
		expect( screen.queryByText( 'No notifications.' ) ).not.toBeInTheDocument();
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		expect( getNoticeHistory() ).toHaveLength( 0 );
		expect( hasDot() ).toBe( false );
		await waitFor( () => expect( bell() ).toHaveFocus() );
		fireEvent.click( bell() );
		expect( await screen.findByText( 'No notifications.' ) ).toBeVisible();
		expect( hasDot() ).toBe( false );
	} );

	it( 'lists past notices with their details and empties the history after clearing all', async () => {
		showToast( {
			title: 'Could not open the terminal.',
			description: 'iTerm is not installed.',
			intent: 'error',
		} );
		await setup();
		fireEvent.click( bell() );
		const history = await screen.findByRole( 'dialog', { name: 'Notification history' } );
		expect( within( history ).getByText( 'Could not open the terminal.' ) ).toBeVisible();
		expect( within( history ).getByText( 'iTerm is not installed.' ) ).toBeVisible();
		fireEvent.click( within( history ).getByRole( 'button', { name: 'Clear all' } ) );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		fireEvent.click( bell() );
		expect( await screen.findByText( 'No notifications.' ) ).toBeVisible();
		expect( screen.queryByRole( 'button', { name: 'Clear all' } ) ).not.toBeInTheDocument();
	} );

	it( 'keeps the cleared notices on screen while the history closes', async () => {
		showToast( { title: 'Site started' } );
		await setup();
		fireEvent.click( bell() );
		await screen.findByText( 'Site started' );
		Element.prototype.getAnimations = () => [ { finished: new Promise( () => {} ) } as Animation ];
		try {
			fireEvent.click( screen.getByRole( 'button', { name: 'Clear all' } ) );
			expect( screen.getByText( 'Site started' ) ).toBeInTheDocument();
			expect( screen.queryByText( 'No notifications.' ) ).not.toBeInTheDocument();
		} finally {
			delete ( Element.prototype as Partial< Element > ).getAnimations;
		}
	} );

	it( 'opens from elsewhere once the sidebar has brought the bell into place', async () => {
		const { container } = await setup();
		let arrive = () => {};
		const slide = {
			effect: { target: container },
			finished: new Promise< void >( ( resolve ) => ( arrive = resolve ) ),
		};
		document.getAnimations = () => [ slide as unknown as Animation ];
		try {
			act( () => openNoticeHistory() );
			expect( screen.queryByText( 'No notifications.' ) ).not.toBeInTheDocument();
			await act( async () => arrive() );
			expect( await screen.findByText( 'No notifications.' ) ).toBeVisible();
		} finally {
			delete ( document as Partial< Document > ).getAnimations;
		}
	} );
} );
