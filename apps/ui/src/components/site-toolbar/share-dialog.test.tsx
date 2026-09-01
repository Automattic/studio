import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import { useDeletePreviewSite, usePublishPreviewSite } from '@/data/queries/use-preview-site';
import { useSnapshots, useSnapshotUsage } from '@/data/queries/use-snapshots';
import { ShareDialog } from './share-dialog';
import type { SiteDetails, Snapshot } from '@/data/core';

vi.mock( '@/data/core', async ( importOriginal ) => ( {
	...( await importOriginal< object >() ),
	useConnector: vi.fn(),
} ) );
vi.mock( '@/data/queries/use-connected-wpcom-sites', () => ( {
	useConnectedWpcomSites: vi.fn(),
} ) );
vi.mock( '@/data/queries/use-preview-site', () => ( {
	usePublishPreviewSite: vi.fn(),
	useDeletePreviewSite: vi.fn(),
} ) );
vi.mock( '@/data/queries/use-snapshots', () => ( {
	useSnapshots: vi.fn(),
	useSnapshotUsage: vi.fn(),
} ) );

const SITE = { id: 'riff', name: 'Riff' } as unknown as SiteDetails;

function snapshot( overrides: Partial< Snapshot > = {} ): Snapshot {
	return {
		url: 'https://riff-abcde-studio.wp.build',
		localSiteId: 'riff',
		atomicSiteId: 1,
		date: Date.now(),
		...overrides,
	} as Snapshot;
}

const publishMutate = vi.fn();
const deleteMutate = vi.fn();
const copyText = vi.fn().mockResolvedValue( undefined );

function renderDialog( snapshots: Snapshot[] = [ snapshot() ], connections: unknown[] = [] ) {
	vi.mocked( useSnapshots ).mockReturnValue( {
		data: snapshots,
	} as ReturnType< typeof useSnapshots > );
	vi.mocked( useSnapshotUsage ).mockReturnValue( {
		data: { siteCount: snapshots.length, siteLimit: 10, siteCreationBlocked: false },
	} as ReturnType< typeof useSnapshotUsage > );
	vi.mocked( useConnectedWpcomSites ).mockReturnValue( { data: connections } as never );
	vi.mocked( useConnector ).mockReturnValue( {
		copyText,
		openExternalUrl: vi.fn(),
	} as unknown as ReturnType< typeof useConnector > );
	vi.mocked( usePublishPreviewSite ).mockReturnValue( {
		mutate: publishMutate,
		isPending: false,
	} as unknown as ReturnType< typeof usePublishPreviewSite > );
	vi.mocked( useDeletePreviewSite ).mockReturnValue( {
		mutate: deleteMutate,
		isPending: false,
		variables: undefined,
	} as unknown as ReturnType< typeof useDeletePreviewSite > );

	return render( <ShareDialog site={ SITE } open onOpenChange={ vi.fn() } /> );
}

describe( 'ShareDialog', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'lists each preview link with its expiry', () => {
		renderDialog();

		expect( screen.getByText( 'riff-abcde-studio.wp.build' ) ).toBeInTheDocument();
		expect( screen.getByText( /Expires in \d+ days?/ ) ).toBeInTheDocument();
	} );

	it( 'offers Republish for an expired preview', async () => {
		const user = userEvent.setup();
		renderDialog( [ snapshot( { date: Date.now() - 30 * 24 * 60 * 60 * 1000 } ) ] );

		expect( screen.getByText( 'Expired' ) ).toBeInTheDocument();

		await user.click( screen.getByRole( 'button', { name: 'More options' } ) );

		expect( await screen.findByRole( 'menuitem', { name: 'Republish' } ) ).toBeInTheDocument();
	} );

	it( 'republishes from the overflow menu', async () => {
		const user = userEvent.setup();
		renderDialog();

		await user.click( screen.getByRole( 'button', { name: 'More options' } ) );
		await user.click(
			await screen.findByRole( 'menuitem', { name: 'Update with current contents' } )
		);

		expect( publishMutate ).toHaveBeenCalledWith(
			{ siteId: 'riff', existingHostname: 'riff-abcde-studio.wp.build' },
			expect.anything()
		);
	} );

	it( 'opens the overflow menu and confirms before deleting', async () => {
		const user = userEvent.setup();
		renderDialog();

		await user.click( screen.getByRole( 'button', { name: 'More options' } ) );
		await user.click( await screen.findByRole( 'menuitem', { name: 'Delete preview link' } ) );

		expect( screen.getByText( 'This link will stop working immediately.' ) ).toBeInTheDocument();
		expect( deleteMutate ).not.toHaveBeenCalled();

		await user.click( screen.getByRole( 'button', { name: 'Delete' } ) );

		expect( deleteMutate ).toHaveBeenCalledWith(
			{ hostname: 'riff-abcde-studio.wp.build' },
			expect.anything()
		);
	} );

	it( 'lists connected live sites above the preview links', async () => {
		const user = userEvent.setup();
		renderDialog(
			[ snapshot() ],
			[ { id: 42, name: 'Riff', url: 'https://riff.com', isStaging: false } ]
		);

		expect( screen.getByText( 'riff.com' ) ).toBeInTheDocument();
		expect( screen.getByRole( 'heading', { name: 'Live' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'heading', { name: 'Preview links' } ) ).toBeInTheDocument();

		await user.click( screen.getAllByRole( 'button', { name: 'Copy link' } )[ 0 ] );

		expect( copyText ).toHaveBeenCalledWith( 'https://riff.com' );
	} );

	it( 'copies the preview link with its protocol', async () => {
		const user = userEvent.setup();
		renderDialog();

		await user.click( screen.getByRole( 'button', { name: 'Copy link' } ) );

		expect( copyText ).toHaveBeenCalledWith( 'https://riff-abcde-studio.wp.build' );
	} );

	it( 'publishes a brand-new preview with no existing hostname', async () => {
		const user = userEvent.setup();
		renderDialog();

		await user.click( screen.getByRole( 'button', { name: 'New preview' } ) );

		expect( publishMutate ).toHaveBeenCalledWith(
			{ siteId: 'riff', existingHostname: undefined },
			expect.anything()
		);
	} );
} );
