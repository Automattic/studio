import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import { SITES_QUERY_KEY } from '@/data/queries/use-sites';
import { DeletedSiteRedirect } from './index';
import type { AiSessionSummary, SiteDetails } from '@/data/core';
import type { SiteEvent } from '@studio/common/lib/cli-events';

const { navigateMock, paramsMock } = vi.hoisted( () => ( {
	navigateMock: vi.fn(),
	paramsMock: vi.fn( (): Record< string, string | undefined > => ( {} ) ),
} ) );

vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => navigateMock,
	useParams: () => paramsMock(),
	createRootRouteWithContext: () => () => ( {} ),
	Outlet: () => null,
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

const DELETED_SITE: SiteDetails = {
	id: 'deleted-site',
	name: 'Deleted Site',
	path: '/sites/deleted',
	port: 8881,
	running: false,
	phpVersion: '8.4',
};

const OTHER_SITE: SiteDetails = { ...DELETED_SITE, id: 'other-site', path: '/sites/other' };

function createSession( id: string, ownerSitePath: string ): AiSessionSummary {
	return {
		id,
		filePath: `/sessions/${ id }.jsonl`,
		createdAt: '2026-07-13T00:00:00.000Z',
		updatedAt: '2026-07-13T00:00:00.000Z',
		activeEnvironment: 'local',
		eventCount: 1,
		ownerSitePath,
	};
}

describe( 'DeletedSiteRedirect', () => {
	let emitSiteEvent: ( event: SiteEvent ) => void;
	let queryClient: QueryClient;

	beforeEach( () => {
		vi.clearAllMocks();
		paramsMock.mockReturnValue( {} );

		vi.mocked( useConnector, { partial: true } ).mockReturnValue( {
			onSiteEvent: ( listener: ( event: SiteEvent ) => void ) => {
				emitSiteEvent = listener;
				return () => undefined;
			},
		} );

		queryClient = new QueryClient();
		queryClient.setQueryData( SITES_QUERY_KEY, [ DELETED_SITE, OTHER_SITE ] );
		queryClient.setQueryData( SESSIONS_QUERY_KEY, [
			createSession( 'doomed-session', DELETED_SITE.path ),
			createSession( 'safe-session', OTHER_SITE.path ),
		] );
	} );

	const renderBridge = () =>
		render(
			<QueryClientProvider client={ queryClient }>
				<DeletedSiteRedirect />
			</QueryClientProvider>
		);

	const emitDelete = ( siteId: string ) =>
		emitSiteEvent( { event: SITE_EVENTS.DELETED, siteId } as SiteEvent );

	it( 'redirects when the open chat belongs to the deleted site', () => {
		paramsMock.mockReturnValue( { sessionId: 'doomed-session' } );
		renderBridge();

		emitDelete( DELETED_SITE.id );

		expect( navigateMock ).toHaveBeenCalledWith( { to: '/' } );
	} );

	it( 'redirects when the open route is the deleted site itself', () => {
		paramsMock.mockReturnValue( { siteId: DELETED_SITE.id } );
		renderBridge();

		emitDelete( DELETED_SITE.id );

		expect( navigateMock ).toHaveBeenCalledWith( { to: '/' } );
	} );

	it( 'stays put when the open chat belongs to another site', () => {
		paramsMock.mockReturnValue( { sessionId: 'safe-session' } );
		renderBridge();

		emitDelete( DELETED_SITE.id );

		expect( navigateMock ).not.toHaveBeenCalled();
	} );

	it( 'ignores site events that are not deletions', () => {
		paramsMock.mockReturnValue( { sessionId: 'doomed-session' } );
		renderBridge();

		emitSiteEvent( { event: SITE_EVENTS.UPDATED, siteId: DELETED_SITE.id } as SiteEvent );

		expect( navigateMock ).not.toHaveBeenCalled();
	} );
} );
