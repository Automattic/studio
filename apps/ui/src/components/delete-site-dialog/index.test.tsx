import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeleteSite } from '@/data/queries/use-sites';
import { removePluginSiteTag, usePluginSiteTag } from '@/lib/plugin-prototype';
import { DeleteSiteDialog } from './index';
import type { SiteDetails } from '@/data/core';

vi.mock( '@/data/queries/use-sites', () => ( {
	useDeleteSite: vi.fn(),
} ) );

vi.mock( '@/lib/plugin-prototype', () => ( {
	removePluginSiteTag: vi.fn(),
	usePluginSiteTag: vi.fn(),
} ) );

const SITE = { id: 'site-1', name: 'My Site' } as SiteDetails;
const mutateAsync = vi.fn();

beforeEach( () => {
	vi.clearAllMocks();
	vi.mocked( usePluginSiteTag ).mockReturnValue( undefined );
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

	it( 'keeps the files when the checkbox is unchecked', async () => {
		mutateAsync.mockResolvedValue( undefined );
		renderDialog();

		await userEvent.click( screen.getByRole( 'checkbox' ) );
		await userEvent.click( screen.getByRole( 'button', { name: 'Delete site' } ) );

		await waitFor( () =>
			expect( mutateAsync ).toHaveBeenCalledWith( { id: 'site-1', deleteFiles: false } )
		);
	} );

	it( 'keeps plugin-specific deletion copy and removes the plugin tag', async () => {
		vi.mocked( usePluginSiteTag ).mockReturnValue( {
			siteId: 'site-1',
			slug: 'my-plugin',
			source: 'new',
		} );
		mutateAsync.mockResolvedValue( undefined );
		renderDialog();

		expect( screen.getByText( /This deletes the plugin along with its test site/ ) ).toBeVisible();
		await userEvent.click( screen.getByRole( 'button', { name: 'Delete plugin' } ) );

		await waitFor( () => expect( removePluginSiteTag ).toHaveBeenCalledWith( 'site-1' ) );
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
