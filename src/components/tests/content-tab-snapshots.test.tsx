// To run tests, execute `npm run test -- src/components/content-tab-snapshots.test.tsx` from the root directory
import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { LIMIT_OF_ZIP_SITES_PER_USER } from '../../constants';
import { useArchiveSite } from '../../hooks/use-archive-site';
import { useAuth } from '../../hooks/use-auth';
import { useDeleteSnapshot } from '../../hooks/use-delete-snapshot';
import { useOffline } from '../../hooks/use-offline';
import { useSiteDetails } from '../../hooks/use-site-details';
import { useSiteUsage } from '../../hooks/use-site-usage';
import { useUpdateDemoSite } from '../../hooks/use-update-demo-site';
import { ContentTabSnapshots } from '../content-tab-snapshots';

const authenticate = jest.fn();
jest.mock( '../../hooks/use-auth' );
jest.mock( '../../hooks/use-site-details' );
jest.mock( '../../hooks/use-site-usage' );

jest.mock( '../../hooks/use-delete-snapshot' );
const deleteSnapshotMock = jest.fn();
( useDeleteSnapshot as jest.Mock ).mockReturnValue( { deleteSnapshot: deleteSnapshotMock } );
jest.mock( '../../hooks/use-update-demo-site' );
const updateDemoSiteMock = jest.fn();
( useUpdateDemoSite as jest.Mock ).mockReturnValue( {
	updateDemoSite: updateDemoSiteMock,
	isDemoSiteUpdating: false,
} );

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
	phpVersion: '8.0',
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
		expect( loginButton ).toBeVisible();
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
		expect( createSnapshotButton ).toBeVisible();
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
		expect( screen.getByRole( 'button', { name: 'https://fake-site.fake' } ) ).toBeVisible();
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
		expect( createSnapshotButton ).toBeVisible();
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
		expect( createSnapshotButton ).toBeVisible();
		expect( createSnapshotButton ).toHaveAttribute( 'aria-disabled', 'true' );
		await user.click( createSnapshotButton );
		expect( archiveSite ).toHaveBeenCalledTimes( 0 );
		await user.hover( createSnapshotButton );
		expect( screen.getByRole( 'tooltip' ) ).toHaveTextContent(
			`You've used all ${ LIMIT_OF_ZIP_SITES_PER_USER } demo sites available on your account.`
		);
	} );

	test( 'should confirm demo site update', async () => {
		const user = userEvent.setup();
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );
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
		mockShowMessageBox.mockResolvedValueOnce( { response: 0, checkboxChecked: false } );
		render( <ContentTabSnapshots selectedSite={ selectedSite } /> );

		const updateButton = await screen.findByRole( 'button', { name: 'Update demo site' } );
		expect( updateButton ).toBeVisible();
		await user.click( updateButton );

		expect( updateDemoSiteMock ).toHaveBeenCalledTimes( 1 );
		expect( mockShowMessageBox ).toHaveBeenCalledWith(
			expect.objectContaining( {
				type: 'info',
				buttons: expect.arrayContaining( [ 'Update', 'Cancel' ] ),
			} )
		);
	} );

	test( 'should cancel demo site update', async () => {
		const user = userEvent.setup();
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );
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

		const updateButton = await screen.findByRole( 'button', { name: 'Update demo site' } );
		expect( updateButton ).toBeVisible();
		await user.click( updateButton );

		expect( updateDemoSiteMock ).not.toHaveBeenCalled();
	} );

	test( 'should not show demo update warning if previously dismissed', async () => {
		const user = userEvent.setup();
		localStorage.setItem( 'dontShowUpdateWarning', 'true' );

		render( <ContentTabSnapshots selectedSite={ selectedSite } /> );
		const updateButton = await screen.findByRole( 'button', { name: 'Update demo site' } );
		await user.click( updateButton );

		expect( mockShowMessageBox ).not.toHaveBeenCalled();
		expect( updateDemoSiteMock ).toHaveBeenCalledTimes( 1 );
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
		expect( deleteSnapshotButton ).toBeVisible();
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
		expect( deleteSnapshotButton ).toBeVisible();
		await user.click( deleteSnapshotButton );

		expect( deleteSnapshotMock ).not.toHaveBeenCalled();
	} );

	test( 'update and delete buttons are disabled when offline', async () => {
		( useOffline as jest.Mock ).mockReturnValue( true );
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );
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
		render( <ContentTabSnapshots selectedSite={ selectedSite } /> );

		const updateButton = await screen.findByRole( 'button', { name: 'Update demo site' } );
		expect( updateButton ).toHaveAttribute( 'aria-disabled', 'true' );
		fireEvent.mouseOver( updateButton );
		expect(
			screen.getByRole( 'tooltip', {
				name: 'Updating a demo site requires an internet connection.',
			} )
		).toBeVisible();
		fireEvent.mouseOut( updateButton );

		const deleteSnapshotButton = screen.getByRole( 'button', { name: 'Delete demo site' } );
		expect( deleteSnapshotButton ).toHaveAttribute( 'aria-disabled', 'true' );
		fireEvent.mouseOver( deleteSnapshotButton );
		expect(
			screen.getByRole( 'tooltip', {
				name: 'Deleting a demo site requires an internet connection.',
			} )
		).toBeVisible();
	} );

	test( 'log in button is disabled when offline', async () => {
		( useOffline as jest.Mock ).mockReturnValue( true );
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: false } );
		render( <ContentTabSnapshots selectedSite={ selectedSite } /> );

		const loginButton = screen.getByRole( 'button', { name: 'Log in to WordPress.com' } );
		expect( loginButton ).toHaveAttribute( 'aria-disabled', 'true' );
		fireEvent.mouseOver( loginButton );
		expect(
			screen.getByRole( 'tooltip', {
				name: 'You’re currently offline.',
			} )
		).toBeVisible();
		fireEvent.mouseOut( loginButton );

		const createAccountLink = screen.getByText( 'Create a free account' );
		expect( createAccountLink ).toHaveAttribute( 'aria-disabled', 'true' );
		fireEvent.mouseOver( createAccountLink );
		expect(
			screen.getByRole( 'tooltip', {
				name: 'You’re currently offline.',
			} )
		).toBeVisible();
	} );
} );

describe( 'AddDemoSiteWithProgress', () => {
	const archiveSite = jest.fn();
	const isUploadingSiteId = jest.fn();
	beforeEach( () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );
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
		expect( screen.getByText( "We're creating your demo site." ) ).toBeVisible();
	} );

	test( 'Progressbar is present when the second snapshot is being created', async () => {
		isUploadingSiteId.mockReturnValue( true );
		render( <ContentTabSnapshots selectedSite={ { ...selectedSite, id: 'site-id-1' } } /> );
		const addDemoSiteButton = screen.queryByRole( 'button', { name: 'Add demo site' } );
		expect( addDemoSiteButton ).not.toBeInTheDocument();
		expect( screen.getByText( "We're creating your new demo site." ) ).toBeVisible();
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

	test( 'Button is disabled when offline', async () => {
		( useOffline as jest.Mock ).mockReturnValue( true );
		render( <ContentTabSnapshots selectedSite={ { ...selectedSite, id: 'site-id-1' } } /> );
		const addDemoSiteButton = screen.getByRole( 'button', { name: 'Add demo site' } );
		expect( addDemoSiteButton ).toHaveAttribute( 'aria-disabled', 'true' );
		fireEvent.mouseOver( addDemoSiteButton );
		const offlineTooltip = screen.getByRole( 'tooltip', {
			name: 'Creating a demo site requires an internet connection.',
		} );
		expect( offlineTooltip ).toBeVisible();
	} );
} );
