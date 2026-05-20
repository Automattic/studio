import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import { usePublishPreviewSite } from '@/data/queries/use-preview-site';
import {
	useDeleteSite,
	useIsSiteStarting,
	useIsSiteStopping,
	useStartSite,
	useStopSite,
} from '@/data/queries/use-sites';
import { useSnapshots } from '@/data/queries/use-snapshots';
import { usePullSiteFromLive, usePushSiteToLive } from '@/data/queries/use-sync-site';
import { SiteDetailsDropdown } from './index';
import type { SiteDetails } from '@/data/core';

const routerMock = vi.hoisted( () => ( {
	navigate: vi.fn(),
} ) );

vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => routerMock.navigate,
} ) );

vi.mock( '@tanstack/react-query', () => ( {
	useIsMutating: () => 0,
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-connected-wpcom-sites', () => ( {
	useConnectedWpcomSites: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-preview-site', () => ( {
	usePublishPreviewSite: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useDeleteSite: vi.fn(),
	useIsSiteStarting: vi.fn(),
	useIsSiteStopping: vi.fn(),
	useStartSite: vi.fn(),
	useStopSite: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-snapshots', () => ( {
	useSnapshots: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sync-site', () => ( {
	PULL_FROM_LIVE_MUTATION_KEY: [ 'pullSiteFromLive' ],
	PUSH_TO_LIVE_MUTATION_KEY: [ 'pushSiteToLive' ],
	usePullSiteFromLive: vi.fn(),
	usePushSiteToLive: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector );
const useConnectedWpcomSitesMock = vi.mocked( useConnectedWpcomSites );
const usePublishPreviewSiteMock = vi.mocked( usePublishPreviewSite );
const useDeleteSiteMock = vi.mocked( useDeleteSite );
const useIsSiteStartingMock = vi.mocked( useIsSiteStarting );
const useIsSiteStoppingMock = vi.mocked( useIsSiteStopping );
const useStartSiteMock = vi.mocked( useStartSite );
const useStopSiteMock = vi.mocked( useStopSite );
const useSnapshotsMock = vi.mocked( useSnapshots );
const usePullSiteFromLiveMock = vi.mocked( usePullSiteFromLive );
const usePushSiteToLiveMock = vi.mocked( usePushSiteToLive );

describe( 'SiteDetailsDropdown', () => {
	const openExternalUrl = vi.fn();
	const publishPreviewMutate = vi.fn();
	const pullMutate = vi.fn();
	const pushMutate = vi.fn();
	const deleteMutate = vi.fn();
	const startMutate = vi.fn();
	const stopMutate = vi.fn();

	beforeEach( () => {
		openExternalUrl.mockReset();
		publishPreviewMutate.mockReset();
		pullMutate.mockReset();
		pushMutate.mockReset();
		deleteMutate.mockReset();
		startMutate.mockReset();
		stopMutate.mockReset();
		routerMock.navigate.mockReset();

		useConnectorMock.mockReturnValue( {
			getPublishCheckoutUrl: () => 'https://wordpress.com/setup/studio',
			openExternalUrl,
		} as never );
		useSnapshotsMock.mockReturnValue( {
			data: [
				{
					url: 'preview.example.wordpress.com',
					atomicSiteId: 123,
					localSiteId: 'site-1',
					date: Date.now(),
				},
			],
		} as never );
		useConnectedWpcomSitesMock.mockReturnValue( {
			data: [
				{
					id: 456,
					localSiteId: 'site-1',
					name: 'Live Site',
					url: 'live.example.com',
					isStaging: false,
					isPressable: false,
					syncSupport: 'syncable',
					lastPullTimestamp: null,
					lastPushTimestamp: null,
				},
			],
		} as never );
		usePublishPreviewSiteMock.mockReturnValue( {
			isPending: false,
			mutate: publishPreviewMutate,
		} as never );
		usePushSiteToLiveMock.mockReturnValue( { mutate: pushMutate } as never );
		usePullSiteFromLiveMock.mockReturnValue( { mutate: pullMutate } as never );
		useDeleteSiteMock.mockReturnValue( {
			isPending: false,
			mutate: deleteMutate,
		} as never );
		useStartSiteMock.mockReturnValue( { mutate: startMutate } as never );
		useStopSiteMock.mockReturnValue( { mutate: stopMutate } as never );
		useIsSiteStartingMock.mockReturnValue( false );
		useIsSiteStoppingMock.mockReturnValue( false );
	} );

	it( 'renders site details and wires the primary row actions', async () => {
		const site = createSite();
		render( <SiteDetailsDropdown site={ site } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Site details for Local Studio Site' } ) );

		expect( await screen.findByText( 'Local' ) ).toBeVisible();
		expect( screen.getByText( 'Preview' ) ).toBeVisible();
		expect( screen.getByText( 'Live' ) ).toBeVisible();
		expect( screen.getAllByText( 'Running on localhost' )[ 0 ] ).toBeVisible();
		expect( screen.getByText( 'Connected' ) ).toBeVisible();

		fireEvent.click( screen.getByRole( 'button', { name: 'Stop site' } ) );
		expect( stopMutate ).toHaveBeenCalledWith( 'site-1' );

		fireEvent.click( screen.getByRole( 'button', { name: 'Push to Preview' } ) );
		expect( publishPreviewMutate ).toHaveBeenCalledWith( {
			siteId: 'site-1',
			existingHostname: 'preview.example.wordpress.com',
		} );

		fireEvent.click( screen.getByRole( 'button', { name: 'Push to Live' } ) );
		expect( pushMutate ).toHaveBeenCalledWith( { siteId: 'site-1', remoteSiteId: 456 } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Pull from Live' } ) );
		expect( pullMutate ).toHaveBeenCalledWith( { siteId: 'site-1', remoteSiteId: 456 } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Open local site' } ) );
		await waitFor( () =>
			expect( openExternalUrl ).toHaveBeenCalledWith( 'http://localhost:8881' )
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Site details for Local Studio Site' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Open site settings' } ) );
		expect( routerMock.navigate ).toHaveBeenCalledWith( {
			to: '/sites/$siteId/settings',
			params: { siteId: 'site-1' },
		} );
	} );

	it( 'confirms before deleting the site from the dropdown', async () => {
		const site = createSite();
		render( <SiteDetailsDropdown site={ site } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Site details for Local Studio Site' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Delete site' } ) );

		const dialog = await screen.findByRole( 'dialog', { name: 'Delete Local Studio Site' } );
		expect(
			within( dialog ).getByText(
				"The site's database will be lost, including all posts, pages, comments, and media."
			)
		).toBeVisible();
		expect(
			within( dialog ).getByRole( 'checkbox', {
				name: 'Delete site files from my computer',
			} )
		).toBeChecked();

		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Delete site' } ) );

		expect( deleteMutate ).toHaveBeenCalledWith(
			{ id: 'site-1', deleteFiles: true },
			expect.objectContaining( {
				onSuccess: expect.any( Function ),
				onError: expect.any( Function ),
			} )
		);

		const options = deleteMutate.mock.calls[ 0 ][ 1 ];
		options.onSuccess();
		expect( routerMock.navigate ).toHaveBeenCalledWith( { to: '/' } );
	} );
} );

function createSite( overrides: Partial< SiteDetails > = {} ): SiteDetails {
	return {
		id: 'site-1',
		name: 'Local Studio Site',
		path: '/tmp/local-studio-site',
		port: 8881,
		running: true,
		phpVersion: '8.4',
		...overrides,
	};
}
