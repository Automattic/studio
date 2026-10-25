import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getNoticeHistory, resetAppMessagesForTests, showToast } from '@/data/app-messages';
import { AppToasts, NoticeHistoryButton } from '@/features/notifications';
import { closeNoticeHistory } from '@/features/notifications/notice-history';
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
			action: { label: 'Open site', onClick: vi.fn() },
		} );
		await setup();
		fireEvent.click( await screen.findByRole( 'button', { name: /Notification history/ } ) );
		const summary = await screen.findByRole( 'button', {
			name: 'View notification: A very long notification title',
		} );
		const action = screen.getByRole( 'button', { name: 'Open site' } );
		expect( action.closest( 'li' ) ).toBe( summary.closest( 'li' ) );
		expect( within( summary ).queryByRole( 'button' ) ).not.toBeInTheDocument();
		const timestamp = within( summary.closest( 'li' )! ).getByText( 'Just now' );
		expect( timestamp ).toBeVisible();
		expect(
			action.compareDocumentPosition( timestamp ) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
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

	it( 'expands full details without adding another notification', async () => {
		showToast( { title: 'Import failed', description: 'Full error details', intent: 'error' } );
		await setup();
		fireEvent.click( bell() );
		fireEvent.click(
			await screen.findByRole( 'button', { name: 'View notification: Import failed' } )
		);
		expect( screen.getByText( 'Full error details' ) ).toBeVisible();
		expect( getNoticeHistory() ).toHaveLength( 1 );
	} );

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
		const description = await screen.findByText( 'Details about the failure' );
		expect( description ).not.toHaveAttribute( 'data-expanded' );
		fireEvent.click( screen.getByRole( 'button', { name: 'View notification: Import failed' } ) );
		expect( screen.getByText( 'Details about the failure' ) ).toBe( description );
		expect( description ).toHaveAttribute( 'data-expanded' );
		expect(
			screen.queryByRole( 'dialog', { name: 'Notification history' } )
		).not.toBeInTheDocument();
		expect( getNoticeHistory() ).toHaveLength( 1 );
		expect( screen.getByRole( 'button', { name: 'Dismiss Import failed' } ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'View notification: Import failed' } ) );
		expect( description ).not.toHaveAttribute( 'data-expanded' );
		expect( description ).not.toHaveAttribute( 'data-clamped' );
		const transition = new Event( 'transitionend', { bubbles: true } );
		Object.defineProperty( transition, 'propertyName', { value: 'height' } );
		fireEvent( description, transition );
		expect( description ).toHaveAttribute( 'data-clamped' );
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
					action: { label: 'Open site', onClick },
				} )
		);
		expect( screen.queryByRole( 'button', { name: 'Details' } ) ).not.toBeInTheDocument();
		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Dismiss Site duplicated: Portfolio' } )
		);
		fireEvent.click( bell() );
		const dialog = await screen.findByRole( 'dialog', { name: 'Notification history' } );
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Open site' } ) );
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

	it( 'shows relative time and one explicit action without a duplicate title button', async () => {
		showToast( {
			title: 'Portfolio duplicated',
			intent: 'success',
			action: { label: 'Open site', onClick: vi.fn() },
		} );
		await setup();
		fireEvent.click( bell() );
		const center = await screen.findByRole( 'dialog', { name: 'Notification history' } );
		expect( within( center ).getByText( 'Just now' ) ).toBeVisible();
		expect( within( center ).getAllByRole( 'button', { name: 'Open site' } ) ).toHaveLength( 1 );
		expect(
			within( center ).queryByRole( 'button', { name: 'Portfolio duplicated' } )
		).not.toBeInTheDocument();
	} );

	it( 'dismisses the toast without clearing its retained notification', async () => {
		await setup( true );
		act( () => {
			showToast( { title: 'Saved' } );
		} );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Dismiss Saved' } ) );
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog', { name: 'Saved' } ) ).not.toBeInTheDocument()
		);
		expect( getNoticeHistory() ).toHaveLength( 1 );
	} );
} );
