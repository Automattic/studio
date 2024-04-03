// To run tests, execute `npm run test -- src/components/content-tab-snapshots.test.tsx` from the root directory
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { LIMIT_OF_ZIP_SITES_PER_USER } from '../../constants';
import { useArchiveSite } from '../../hooks/use-archive-site';
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
( useArchiveSite as jest.Mock ).mockReturnValue( {
	archiveSite,
	isUploadingSiteId: jest.fn().mockReturnValue( false ),
} );
jest.mock( '../../hooks/use-archive-site' );
const mockShowMessageBox = jest.fn();
jest.mock( '../../lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		openURL: jest.fn(),
		generateProposedSitePath: jest.fn(),
		showMessageBox: mockShowMessageBox,
	} ),
} ) );

const selectedSite = {
	id: 'site-id-1',
	name: 'Test Site',
	running: false as const,
	path: '/test-site',
	adminPassword: btoa( 'test-password' ),
};

afterEach( () => {
	jest.clearAllMocks();
} );

describe( 'ContentTabSnapshots', () => {
	test( 'renders NoAuth component when not authenticated and the log in button triggers the authenticate flow', async () => {
		const user = userEvent.setup();
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: false, authenticate } );
		( useSiteDetails as jest.Mock ).mockReturnValue( { snapshots: [], uploadingSites: {} } );
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

	test( 'renders NoSnapshots component when authenticated with no demo sites', async () => {
		const user = userEvent.setup();
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );
		( useSiteDetails as jest.Mock ).mockReturnValue( { snapshots: [], uploadingSites: {} } );
		( useSiteUsage as jest.Mock ).mockReturnValue( {
			siteLimit: LIMIT_OF_ZIP_SITES_PER_USER,
			siteCount: 1,
		} );
		render( <ContentTabSnapshots selectedSite={ selectedSite } /> );
		const createSnapshotButton = screen.getByRole( 'button', { name: 'Add demo site' } );
		expect( createSnapshotButton ).toBeInTheDocument();
		await user.click( createSnapshotButton );
		expect( archiveSite ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'renders the list of demo sites for a given a selected site', () => {
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
			uploadingSites: {},
		} );
		render( <ContentTabSnapshots selectedSite={ selectedSite } /> );
		expect( screen.getByRole( 'button', { name: 'https://fake-site.fake' } ) ).toBeInTheDocument();
	} );

	test( 'hide the list of demo sites that do not belong to the selected site', () => {
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
			uploadingSites: {},
		} );
		render( <ContentTabSnapshots selectedSite={ selectedSite } /> );
		expect(
			screen.getByText( 'Get feedback from anyone', {
				exact: false,
			} )
		).toBeInTheDocument();
		expect( screen.queryByText( 'fake-site.fake' ) ).not.toBeInTheDocument();
	} );

	test( 'test the Add demo site button when the list is displayed', async () => {
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
			uploadingSites: {},
		} );
		render( <ContentTabSnapshots selectedSite={ selectedSite } /> );
		const createSnapshotButton = screen.getByRole( 'button', { name: 'Add demo site' } );
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
			uploadingSites: {},
		} );
		render( <ContentTabSnapshots selectedSite={ selectedSite } /> );
		const createSnapshotButton = screen.getByRole( 'button', { name: 'Add demo site' } );
		expect( createSnapshotButton ).toBeInTheDocument();
		expect( createSnapshotButton ).toHaveAttribute( 'aria-disabled', 'true' );
		await user.click( createSnapshotButton );
		expect( archiveSite ).toHaveBeenCalledTimes( 0 );
		await user.hover( createSnapshotButton );
		expect( screen.getByRole( 'tooltip' ) ).toHaveTextContent(
			`You've used all ${ LIMIT_OF_ZIP_SITES_PER_USER } demo sites available on your account.`
		);
	} );

	test( 'should confirm snapshot deletion', async () => {
		const user = userEvent.setup();
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );
		( useSiteUsage as jest.Mock ).mockReturnValue( {
			siteLimit: LIMIT_OF_ZIP_SITES_PER_USER,
			siteCount: 1,
		} );
		const dateMS = new Date().getTime();
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			snapshots: [
				{
					url: 'fake-site.fake',
					atomicSiteId: 150,
					localSiteId: 'site-id-1',
					date: dateMS,
					deleted: false,
				},
			],
			uploadingSites: {},
		} );
		mockShowMessageBox.mockResolvedValueOnce( { response: 0 } );
		render( <ContentTabSnapshots selectedSite={ selectedSite } /> );

		const deleteSnapshotButton = screen.getByRole( 'button', { name: 'Delete demo site' } );
		expect( deleteSnapshotButton ).toBeInTheDocument();
		await user.click( deleteSnapshotButton );

		expect( deleteSnapshotMock ).toHaveBeenCalledWith( {
			url: 'fake-site.fake',
			atomicSiteId: 150,
			localSiteId: 'site-id-1',
			date: dateMS,
			deleted: false,
		} );
	} );

	test( 'should cancel snapshot deletion', async () => {
		const user = userEvent.setup();
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );
		( useSiteUsage as jest.Mock ).mockReturnValue( {
			siteLimit: LIMIT_OF_ZIP_SITES_PER_USER,
			siteCount: 1,
		} );
		const dateMS = new Date().getTime();
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			snapshots: [
				{
					url: 'fake-site.fake',
					atomicSiteId: 150,
					localSiteId: 'site-id-1',
					date: dateMS,
					deleted: false,
				},
			],
			uploadingSites: {},
		} );
		mockShowMessageBox.mockResolvedValueOnce( { response: 1 } );
		render( <ContentTabSnapshots selectedSite={ selectedSite } /> );

		const deleteSnapshotButton = screen.getByRole( 'button', { name: 'Delete demo site' } );
		expect( deleteSnapshotButton ).toBeInTheDocument();
		await user.click( deleteSnapshotButton );

		expect( deleteSnapshotMock ).not.toHaveBeenCalled();
	} );
} );

describe( 'AddDemoSiteWithProgress', () => {
	const archiveSite = jest.fn();
	const isUploadingSiteId = jest.fn();
	beforeEach( () => {
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
			uploadingSites: {},
		} );
		( useArchiveSite as jest.Mock ).mockReturnValue( {
			archiveSite,
			isUploadingSiteId,
			isAnySiteArchiving: false,
		} );
	} );

	test( 'Progressbar is present instead of the button', async () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			snapshots: [
				{
					url: 'fake-site.fake',
					atomicSiteId: 150,
					localSiteId: 'site-id-1',
					date: 1707232820627,
					deleted: false,
					isLoading: true,
				},
			],
			uploadingSites: {},
		} );
		isUploadingSiteId.mockReturnValue( true );
		render( <ContentTabSnapshots selectedSite={ { ...selectedSite, id: 'site-id-1' } } /> );
		const addDemoSiteButton = screen.queryByRole( 'button', { name: 'Add demo site' } );
		expect( addDemoSiteButton ).not.toBeInTheDocument();
		expect( screen.getByText( "We're creating your demo site." ) ).toBeInTheDocument();
	} );

	test( 'Progressbar is present when the second snapshot is being created', async () => {
		isUploadingSiteId.mockReturnValue( true );
		render( <ContentTabSnapshots selectedSite={ { ...selectedSite, id: 'site-id-1' } } /> );
		const addDemoSiteButton = screen.queryByRole( 'button', { name: 'Add demo site' } );
		expect( addDemoSiteButton ).not.toBeInTheDocument();
		expect( screen.getByText( "We're creating your new demo site." ) ).toBeInTheDocument();
	} );

	test( 'Button is enabled when no snapshots and no other site is being archived', async () => {
		isUploadingSiteId.mockReturnValue( false );
		render( <ContentTabSnapshots selectedSite={ { ...selectedSite, id: 'site-id-1' } } /> );
		const addDemoSiteButton = screen.getByRole( 'button', { name: 'Add demo site' } );
		expect( addDemoSiteButton ).toBeEnabled();
	} );
	test( 'Button is disabled when another site is being archived', async () => {
		( useArchiveSite as jest.Mock ).mockReturnValue( {
			archiveSite,
			isUploadingSiteId,
			isAnySiteArchiving: true,
		} );
		render( <ContentTabSnapshots selectedSite={ { ...selectedSite, id: 'site-id-2' } } /> );
		const addDemoSiteButton = screen.getByRole( 'button', { name: 'Add demo site' } );
		expect( addDemoSiteButton ).toHaveAttribute( 'aria-disabled', 'true' );
	} );
} );
