import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeleteSite } from '@/data/queries/use-sites';
import { DeleteSiteDialog } from './index';
import type { SiteDetails } from '@/data/core';

vi.mock( '@/data/queries/use-sites', () => ( {
	useDeleteSite: vi.fn(),
} ) );

// Base UI's checkbox dispatches a PointerEvent, which jsdom lacks.
vi.stubGlobal( 'PointerEvent', window.PointerEvent ?? MouseEvent );

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
		<DeleteSiteDialog sites={ [ SITE ] } open onOpenChange={ vi.fn() } onDeleted={ onDeleted } />
	);
}

describe( 'DeleteSiteDialog', () => {
	it( 'keeps the files unless asked, and focuses Cancel so Return does not remove', async () => {
		mutateAsync.mockResolvedValue( undefined );
		const onDeleted = vi.fn();
		renderDialog( onDeleted );

		expect(
			screen.getByRole( 'alertdialog', { name: 'Remove “My Site” from WordPress Studio?' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'checkbox', { name: 'Also move files and database to Trash' } )
		).not.toBeChecked();
		await waitFor( () => expect( screen.getByRole( 'button', { name: 'Cancel' } ) ).toHaveFocus() );
		fireEvent.keyDown( screen.getByRole( 'checkbox' ), { key: 'Enter' } );
		expect( mutateAsync ).not.toHaveBeenCalled();

		await userEvent.click( screen.getByRole( 'button', { name: 'Remove site' } ) );

		await waitFor( () =>
			expect( mutateAsync ).toHaveBeenCalledWith( { id: 'site-1', deleteFiles: false } )
		);
		expect( onDeleted ).toHaveBeenCalled();
	} );

	it( 'moves the files to Trash when the checkbox is ticked', async () => {
		mutateAsync.mockResolvedValue( undefined );
		renderDialog();

		await userEvent.click( screen.getByRole( 'checkbox' ) );
		await userEvent.click( screen.getByRole( 'button', { name: 'Remove site' } ) );

		await waitFor( () =>
			expect( mutateAsync ).toHaveBeenCalledWith( { id: 'site-1', deleteFiles: true } )
		);
	} );

	it( 'stays open and shows the failure reason when deleting fails', async () => {
		mutateAsync.mockRejectedValue( new Error( 'Site is running' ) );
		const onDeleted = vi.fn();
		renderDialog( onDeleted );

		await userEvent.click( screen.getByRole( 'button', { name: 'Remove site' } ) );

		const dialog = await screen.findByRole( 'alertdialog' );
		expect( await within( dialog ).findByText( 'Site is running' ) ).toBeVisible();
		expect( onDeleted ).not.toHaveBeenCalled();
	} );
} );
