import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoticeHistoryDialog } from '@/components/notice-history';
import { showToast, resetAppMessagesForTests } from '@/data/app-messages';
import { AppToasts } from './index';

vi.mock( '@/hooks/use-color-scheme', () => ( {
	useColorScheme: () => 'light',
} ) );

describe( 'AppToasts', () => {
	afterEach( () => {
		resetAppMessagesForTests();
	} );

	it( 'replaces a toast in place when the same id is shown again', () => {
		render( <AppToasts /> );

		act( () => {
			showToast( { id: 'sync-1', intent: 'info', title: 'Pushing to live', durationMs: 0 } );
		} );
		expect( screen.getByText( 'Pushing to live' ) ).toBeVisible();

		act( () => {
			showToast( { id: 'sync-1', intent: 'success', title: 'Push complete' } );
		} );
		expect( screen.getByText( 'Push complete' ) ).toBeVisible();
		expect( screen.queryByText( 'Pushing to live' ) ).not.toBeInTheDocument();
	} );

	it( 'survives a replacement that drops the description', () => {
		render( <AppToasts /> );

		// A running sync carries phase detail; its result usually doesn't. The
		// shared Notice cannot be reused across that change.
		act( () => {
			showToast( {
				id: 'sync-1',
				intent: 'info',
				title: 'Pushing to live',
				description: 'Uploading… 62%',
				durationMs: 0,
			} );
		} );
		expect( screen.getByText( 'Uploading… 62%' ) ).toBeVisible();

		act( () => {
			showToast( { id: 'sync-1', intent: 'success', title: 'Push complete' } );
		} );

		expect( screen.getByText( 'Push complete' ) ).toBeVisible();
		expect( screen.queryByText( 'Uploading… 62%' ) ).not.toBeInTheDocument();
	} );

	it( 'keeps a pinned toast open with no expiry timer', () => {
		render( <AppToasts /> );

		act( () => {
			showToast( { id: 'sync-1', intent: 'info', title: 'Pulling from live', durationMs: 0 } );
		} );

		expect( screen.getByText( 'Pulling from live' ) ).toBeVisible();
	} );

	it( 'offers Copy and More only on error toasts with details', () => {
		render(
			<>
				<AppToasts />
				<NoticeHistoryDialog />
			</>
		);

		act( () => {
			showToast( { intent: 'success', title: 'Saved', description: 'All good.' } );
			showToast( { intent: 'error', title: 'Failed', description: 'Stack trace…' } );
		} );

		expect( screen.getByRole( 'button', { name: 'Copy' } ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'More' } ) );
		expect( screen.getByRole( 'dialog' ) ).toBeVisible();
		expect( screen.getAllByText( 'Stack trace…' ) ).toHaveLength( 2 );
	} );
} );
