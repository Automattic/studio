// To run tests, execute `npm run test -- src/components/content-tab-snapshots.test.tsx` from the root directory
import { render, screen, fireEvent } from '@testing-library/react';
import { useAuth } from '../hooks/use-auth';
import { useDeleteSnapshot } from '../hooks/use-delete-snapshot';
import { useSiteDetails } from '../hooks/use-site-details';
import { ContentTabSnapshots } from './content-tab-snapshots';

const authenticate = jest.fn();
jest.mock( '../hooks/use-auth' );
jest.mock( '../hooks/use-site-details' );

jest.mock( '../hooks/use-delete-snapshot' );
const deleteSnapshotMock = jest.fn();
( useDeleteSnapshot as jest.Mock ).mockReturnValue( { deleteSnapshot: deleteSnapshotMock } );

const archiveSite = jest.fn();
jest.mock( '../hooks/use-archive-site', () => ( {
	useArchiveSite: () => ( {
		archiveSite,
		isUploadingSiteId: jest.fn(),
	} ),
} ) );

jest.mock( '../lib/get-ipc-api', () => ( {
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
};

describe( 'ContentTabSnapshots', () => {
	test( 'renders NoAuth component when not authenticated and the log in button triggers the authenticate flow', () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: false, authenticate } );
		( useSiteDetails as jest.Mock ).mockReturnValue( { snapshots: [] } );
		render( <ContentTabSnapshots selectedSite={ selectedSite } /> );
		const loginButton = screen.getByRole( 'button', { name: 'Log in to WordPress.com' } );
		expect( loginButton ).toBeInTheDocument();
		fireEvent.click( loginButton );
		expect( authenticate ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'renders NoSnapshots component when authenticated with no preview links', () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );
		( useSiteDetails as jest.Mock ).mockReturnValue( { snapshots: [] } );
		render( <ContentTabSnapshots selectedSite={ selectedSite } /> );
		const createSnapshotButton = screen.getByRole( 'button', { name: 'Create preview link' } );
		expect( createSnapshotButton ).toBeInTheDocument();
		fireEvent.click( createSnapshotButton );
		expect( archiveSite ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'renders the list of preview links for a given a selected site', () => {
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
		} );
		render( <ContentTabSnapshots selectedSite={ selectedSite } /> );
		expect( screen.getByText( '1 PREVIEW LINK' ) ).toBeInTheDocument();
		expect( screen.getByText( 'https://fake-site.fake' ) ).toBeInTheDocument();
	} );

	test( 'hide the list of preview links that do not belong to the selected site', () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );
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

	test( 'test the create preview link button when the list is displayed', () => {
		archiveSite.mockClear();
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
		} );
		render( <ContentTabSnapshots selectedSite={ selectedSite } /> );
		const createSnapshotButton = screen.getByRole( 'button', { name: 'Create preview link' } );
		expect( createSnapshotButton ).toBeInTheDocument();
		fireEvent.click( createSnapshotButton );
		expect( archiveSite ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'test the delete snapshot button from the more menu when the list is displayed', () => {
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
		} );
		render( <ContentTabSnapshots selectedSite={ selectedSite } /> );
		const moreOptionsButton = screen.getByRole( 'button', { name: 'More options' } );
		expect( moreOptionsButton ).toBeInTheDocument();
		fireEvent.click( moreOptionsButton );
		const deleteSnapshotButton = screen.getByRole( 'menuitem', { name: 'Delete preview link' } );
		expect( deleteSnapshotButton ).toBeInTheDocument();
		fireEvent.click( deleteSnapshotButton );
		expect( deleteSnapshotMock ).toHaveBeenCalledWith( {
			url: 'fake-site.fake',
			atomicSiteId: 150,
			localSiteId: 'site-id-1',
			date: 1707232820627,
			deleted: false,
		} );
	} );
} );
