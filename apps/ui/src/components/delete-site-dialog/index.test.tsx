import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeleteSite } from '@/data/queries/use-sites';
import { DeleteSiteDialog } from './index';
import type { SiteDetails } from '@/data/core';

vi.mock( '@/data/queries/use-sites', () => ( {
	useDeleteSite: vi.fn(),
} ) );

// The dialog's theme scope reads the resolved color scheme, which needs the
// connector + query providers this test deliberately renders without.
vi.mock( '@/hooks/use-color-scheme', () => ( {
	useColorScheme: () => 'light',
} ) );

const SITE = { id: 'site-1', name: 'My Site' } as SiteDetails;
const mutateAsync = vi.fn();

beforeEach( () => {
	vi.clearAllMocks();
	vi.mocked( useDeleteSite ).mockReturnValue( { mutateAsync } as unknown as ReturnType<
		typeof useDeleteSite
	> );
} );

function renderDialog( onDeleted?: () => void ) {
	return render(
		<DeleteSiteDialog site={ SITE } open onOpenChange={ vi.fn() } onDeleted={ onDeleted } />
	);
}

describe( 'DeleteSiteDialog', () => {
	it( 'deletes the site and its files on confirm', async () => {
		mutateAsync.mockResolvedValue( undefined );
		const onDeleted = vi.fn();
		renderDialog( onDeleted );

		await userEvent.click( screen.getByRole( 'button', { name: 'Delete site' } ) );

		await waitFor( () =>
			expect( mutateAsync ).toHaveBeenCalledWith( { id: 'site-1', deleteFiles: true } )
		);
		expect( onDeleted ).toHaveBeenCalled();
	} );

	// Guards the wiring rather than the behavior: the hook finds the confirm
	// button by label, so this fails if the two ever drift apart.
	it( 'confirms when Return is pressed inside the dialog', async () => {
		mutateAsync.mockResolvedValue( undefined );
		renderDialog();

		fireEvent.keyDown( screen.getByRole( 'checkbox' ), { key: 'Enter' } );

		await waitFor( () =>
			expect( mutateAsync ).toHaveBeenCalledWith( { id: 'site-1', deleteFiles: true } )
		);
	} );

	it( 'keeps the files when the checkbox is unchecked', async () => {
		mutateAsync.mockResolvedValue( undefined );
		renderDialog();

		await userEvent.click( screen.getByRole( 'checkbox' ) );
		await userEvent.click( screen.getByRole( 'button', { name: 'Delete site' } ) );

		await waitFor( () =>
			expect( mutateAsync ).toHaveBeenCalledWith( { id: 'site-1', deleteFiles: false } )
		);
	} );

	it( 'stays open and shows the failure reason when deleting fails', async () => {
		mutateAsync.mockRejectedValue( new Error( 'Site is running' ) );
		const onDeleted = vi.fn();
		renderDialog( onDeleted );

		await userEvent.click( screen.getByRole( 'button', { name: 'Delete site' } ) );

		// Scoped to the dialog: the error is also announced in an aria-live region.
		const dialog = await screen.findByRole( 'alertdialog' );
		expect( await within( dialog ).findByText( 'Site is running' ) ).toBeVisible();
		expect( onDeleted ).not.toHaveBeenCalled();
	} );
} );
