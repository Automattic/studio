// To run tests, execute `npm run test -- src/components/content-tab-snapshots.test.tsx` from the root directory
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { LIMIT_OF_ZIP_SITES_PER_USER } from '../../constants';
import { useAuth } from '../../hooks/use-auth';
import { useDeleteSnapshot } from '../../hooks/use-delete-snapshot';
import { useSiteDetails } from '../../hooks/use-site-details';
import { useSiteUsage } from '../../hooks/use-site-usage';
import { ContentTabSnapshots } from '../content-tab-snapshots';

const authenticate = jest.fn();
jest.mock( '../../hooks/use-auth' );
jest.mock( '../../hooks/use-site-details' );
jest.mock( '../../hooks/use-site-usage' );

jest.mock( '../../hooks/use-delete-snapshot' );
const deleteSnapshotMock = jest.fn();
( useDeleteSnapshot as jest.Mock ).mockReturnValue( { deleteSnapshot: deleteSnapshotMock } );

const archiveSite = jest.fn();
jest.mock( '../../hooks/use-archive-site', () => ( {
	useArchiveSite: () => ( {
		archiveSite,
		isUploadingSiteId: jest.fn(),
	} ),
} ) );

jest.mock( '../../lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		openURL: jest.fn(),
		generateProposedSitePath: jest.fn(),
	} ),
} ) );

const selectedSite = {
	id: 'site-id-1',
	name: 'Test Site',
	running: false as const,
	path: '/test-site',
	adminPassword: btoa( 'test-password' ),
};

describe( 'ContentTabSnapshots', () => {
	test( 'renders NoAuth component when not authenticated and the log in button triggers the authenticate flow', async () => {
		const user = userEvent.setup();
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: false, authenticate } );
		( useSiteDetails as jest.Mock ).mockReturnValue( { snapshots: [] } );
		( useSiteUsage as jest.Mock ).mockReturnValue( {
			siteLimit: LIMIT_OF_ZIP_SITES_PER_USER,
			siteCount: 1,
		} );
		render( <ContentTabSnapshots selectedSite={ selectedSite } /> );
		const loginButton = screen.getByRole( 'button', { name: 'Log in to WordPress.com' } );
		expect( loginButton ).toBeInTheDocument();
		await user.click( loginButton );
		expect( authenticate ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'renders NoSnapshots component when authenticated with no preview links', async () => {
		const user = userEvent.setup();
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );
		( useSiteDetails as jest.Mock ).mockReturnValue( { snapshots: [] } );
		( useSiteUsage as jest.Mock ).mockReturnValue( {
			siteLimit: LIMIT_OF_ZIP_SITES_PER_USER,
			siteCount: 1,
		} );
		render( <ContentTabSnapshots selectedSite={ selectedSite } /> );
		const createSnapshotButton = screen.getByRole( 'button', { name: 'Create preview link' } );
		expect( createSnapshotButton ).toBeInTheDocument();
		await user.click( createSnapshotButton );
		expect( archiveSite ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'renders the list of preview links for a given a selected site', () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );
		( useSiteUsage as jest.Mock ).mockReturnValue( {
			siteLimit: LIMIT_OF_ZIP_SITES_PER_USER,
			siteCount: 1,
		} );
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			snapshots: [
				{
					url: 'fake-site.fake',
					atomicSiteId: 150,
					localSiteId: 'site-id-1',
					date: 1707232820627,
					deleted: false,
				},
			],
		} );
		render( <ContentTabSnapshots selectedSite={ selectedSite } /> );
		expect( screen.getByText( '1 PREVIEW LINK' ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'https://fake-site.fake' } ) ).toBeInTheDocument();
	} );

	test( 'hide the list of preview links that do not belong to the selected site', () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );
		( useSiteUsage as jest.Mock ).mockReturnValue( {
			siteLimit: LIMIT_OF_ZIP_SITES_PER_USER,
			siteCount: 1,
		} );
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			snapshots: [
				{
					url: 'fake-site.fake',
					atomicSiteId: 150,
					localSiteId: 'site-id-X',
					date: 1707232820627,
					deleted: false,
				},
			],
		} );
		render( <ContentTabSnapshots selectedSite={ selectedSite } /> );
		expect( screen.getByText( 'Get feedback on ', { exact: false } ) ).toBeInTheDocument();
		expect( screen.queryByText( 'fake-site.fake' ) ).not.toBeInTheDocument();
	} );

	test( 'test the create preview link button when the list is displayed', async () => {
		const user = userEvent.setup();
		archiveSite.mockClear();
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );
		( useSiteUsage as jest.Mock ).mockReturnValue( {
			siteLimit: LIMIT_OF_ZIP_SITES_PER_USER,
			siteCount: 1,
		} );
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			snapshots: [
				{
					url: 'fake-site.fake',
					atomicSiteId: 150,
					localSiteId: 'site-id-1',
					date: 1707232820627,
					deleted: false,
				},
			],
		} );
		render( <ContentTabSnapshots selectedSite={ selectedSite } /> );
		const createSnapshotButton = screen.getByRole( 'button', { name: 'Create preview link' } );
		expect( createSnapshotButton ).toBeInTheDocument();
		await user.click( createSnapshotButton );
		expect( archiveSite ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'test that create site button is disabled if the limit has been reached', async () => {
		const user = userEvent.setup();
		archiveSite.mockClear();
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );
		( useSiteUsage as jest.Mock ).mockReturnValue( {
			siteLimit: LIMIT_OF_ZIP_SITES_PER_USER,
			siteCount: LIMIT_OF_ZIP_SITES_PER_USER,
		} );
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			snapshots: [
				{
					url: 'fake-site.fake',
					atomicSiteId: 150,
					localSiteId: 'site-id-1',
					date: 1707232820627,
					deleted: false,
				},
			],
		} );
		render( <ContentTabSnapshots selectedSite={ selectedSite } /> );
		const createSnapshotButton = screen.getByRole( 'button', { name: 'Create preview link' } );
		expect( createSnapshotButton ).toBeInTheDocument();
		expect( createSnapshotButton ).toBeDisabled();
		await user.click( createSnapshotButton );
		expect( archiveSite ).toHaveBeenCalledTimes( 0 );
		await user.hover( createSnapshotButton );
		expect( screen.getByRole( 'tooltip' ) ).toHaveTextContent(
			`You've used all ${ LIMIT_OF_ZIP_SITES_PER_USER } preview links available on your account.`
		);
	} );

	test( 'test the delete snapshot button from the more menu when the list is displayed', async () => {
		const user = userEvent.setup();
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );
		( useSiteUsage as jest.Mock ).mockReturnValue( {
			siteLimit: LIMIT_OF_ZIP_SITES_PER_USER,
			siteCount: 1,
		} );
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			snapshots: [
				{
					url: 'fake-site.fake',
					atomicSiteId: 150,
					localSiteId: 'site-id-1',
					date: 1707232820627,
					deleted: false,
				},
			],
		} );
		render( <ContentTabSnapshots selectedSite={ selectedSite } /> );
		const moreOptionsButton = screen.getByRole( 'button', { name: 'More options' } );
		expect( moreOptionsButton ).toBeInTheDocument();
		await user.click( moreOptionsButton );
		const deleteSnapshotButton = screen.getByRole( 'menuitem', { name: 'Delete preview link' } );
		expect( deleteSnapshotButton ).toBeInTheDocument();
		await user.click( deleteSnapshotButton );
		expect( deleteSnapshotMock ).toHaveBeenCalledWith( {
			url: 'fake-site.fake',
			atomicSiteId: 150,
			localSiteId: 'site-id-1',
			date: 1707232820627,
			deleted: false,
		} );
	} );
} );
