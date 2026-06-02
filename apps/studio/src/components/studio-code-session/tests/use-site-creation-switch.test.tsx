// Run tests: npm test -- src/components/studio-code-session/tests/use-site-creation-switch.test.tsx
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSiteCreationSwitch } from '../use-site-creation-switch';
import type { IpcRendererEvent } from 'electron';
import type { AiSessionPlacementUpdatedEvent } from 'src/lib/ai-session-placement';

const STORAGE_KEY = 'studio_code_session_ids';

const { mockUseIpcListener, siteDetails } = vi.hoisted( () => ( {
	mockUseIpcListener: vi.fn(),
	siteDetails: {
		sites: [] as Array< { id: string } >,
		setSelectedSiteId: vi.fn(),
	},
} ) );

vi.mock( 'src/hooks/use-ipc-listener', () => ( {
	useIpcListener: mockUseIpcListener,
} ) );

vi.mock( 'src/hooks/use-site-details', () => ( {
	useSiteDetails: () => siteDetails,
} ) );

function emitPlacement( payload: AiSessionPlacementUpdatedEvent ) {
	const listener = mockUseIpcListener.mock.calls.at( -1 )?.[ 1 ];
	if ( ! listener ) {
		throw new Error( 'ai-session-placement-updated listener was not registered' );
	}
	act( () => {
		listener( {} as IpcRendererEvent, payload );
	} );
}

function placementEvent( sessionId: string, siteId: string, siteName = 'New Site' ) {
	return {
		sessionId,
		placement: {
			kind: 'site' as const,
			siteId,
			sitePath: `/Users/me/Studio/${ siteId }`,
			siteName,
		},
	};
}

function readStoredMap(): Record< string, string > {
	const raw = localStorage.getItem( STORAGE_KEY );
	return raw ? ( JSON.parse( raw ) as Record< string, string > ) : {};
}

beforeEach( () => {
	mockUseIpcListener.mockReset();
	siteDetails.setSelectedSiteId.mockReset();
	siteDetails.sites = [];
	localStorage.clear();
} );

describe( 'useSiteCreationSwitch', () => {
	it( 'surfaces a pending switch and maps the new site to the session on placement', () => {
		siteDetails.sites = [ { id: 'old-site' }, { id: 'new-site' } ];
		const { result } = renderHook( () =>
			useSiteCreationSwitch( {
				sessionId: 'session-1',
				currentSiteId: 'old-site',
				onStartNewChat: vi.fn(),
			} )
		);

		emitPlacement( placementEvent( 'session-1', 'new-site', 'My New Site' ) );

		expect( result.current.pending ).toEqual( { siteId: 'new-site', siteName: 'My New Site' } );
		// The conversation is claimed by the new site immediately.
		expect( readStoredMap()[ 'new-site' ] ).toBe( 'session-1' );
	} );

	it( 'ignores placement events for a different session', () => {
		const { result } = renderHook( () =>
			useSiteCreationSwitch( {
				sessionId: 'session-1',
				currentSiteId: 'old-site',
				onStartNewChat: vi.fn(),
			} )
		);

		emitPlacement( placementEvent( 'some-other-session', 'new-site' ) );

		expect( result.current.pending ).toBeNull();
		expect( readStoredMap() ).toEqual( {} );
	} );

	it( 'ignores a placement onto the current site (no migration)', () => {
		const { result } = renderHook( () =>
			useSiteCreationSwitch( {
				sessionId: 'session-1',
				currentSiteId: 'old-site',
				onStartNewChat: vi.fn(),
			} )
		);

		emitPlacement( placementEvent( 'session-1', 'old-site' ) );

		expect( result.current.pending ).toBeNull();
	} );

	it( 'openNewSite switches to the new site and forgets it on the current site', () => {
		siteDetails.sites = [ { id: 'old-site' }, { id: 'new-site' } ];
		localStorage.setItem( STORAGE_KEY, JSON.stringify( { 'old-site': 'session-1' } ) );

		const { result } = renderHook( () =>
			useSiteCreationSwitch( {
				sessionId: 'session-1',
				currentSiteId: 'old-site',
				onStartNewChat: vi.fn(),
			} )
		);

		emitPlacement( placementEvent( 'session-1', 'new-site' ) );
		act( () => result.current.openNewSite() );

		expect( siteDetails.setSelectedSiteId ).toHaveBeenCalledWith( 'new-site' );
		const map = readStoredMap();
		expect( map[ 'new-site' ] ).toBe( 'session-1' );
		expect( map[ 'old-site' ] ).toBeUndefined();
		expect( result.current.pending ).toBeNull();
	} );

	it( 'defers the switch until the new site appears in the site list', () => {
		siteDetails.sites = [ { id: 'old-site' } ]; // new site not propagated yet
		const { result, rerender } = renderHook( () =>
			useSiteCreationSwitch( {
				sessionId: 'session-1',
				currentSiteId: 'old-site',
				onStartNewChat: vi.fn(),
			} )
		);

		emitPlacement( placementEvent( 'session-1', 'new-site' ) );
		act( () => result.current.openNewSite() );

		// Not switched yet — the id isn't in the list.
		expect( siteDetails.setSelectedSiteId ).not.toHaveBeenCalled();

		// The CREATED site-event lands; the deferred switch completes.
		siteDetails.sites = [ { id: 'old-site' }, { id: 'new-site' } ];
		rerender();

		expect( siteDetails.setSelectedSiteId ).toHaveBeenCalledWith( 'new-site' );
	} );

	it( 'stayHere starts a new chat on the current site without switching', () => {
		siteDetails.sites = [ { id: 'old-site' }, { id: 'new-site' } ];
		const onStartNewChat = vi.fn();

		const { result } = renderHook( () =>
			useSiteCreationSwitch( {
				sessionId: 'session-1',
				currentSiteId: 'old-site',
				onStartNewChat,
			} )
		);

		emitPlacement( placementEvent( 'session-1', 'new-site' ) );
		act( () => result.current.stayHere() );

		expect( onStartNewChat ).toHaveBeenCalledOnce();
		expect( siteDetails.setSelectedSiteId ).not.toHaveBeenCalled();
		expect( result.current.pending ).toBeNull();
	} );

	it( 'does not run the stay branch after the user chose to open the new site', () => {
		siteDetails.sites = [ { id: 'old-site' }, { id: 'new-site' } ];
		const onStartNewChat = vi.fn();

		const { result } = renderHook( () =>
			useSiteCreationSwitch( {
				sessionId: 'session-1',
				currentSiteId: 'old-site',
				onStartNewChat,
			} )
		);

		emitPlacement( placementEvent( 'session-1', 'new-site' ) );
		act( () => result.current.openNewSite() );
		// Dialog close fires the dismissal path; it must be a no-op now.
		act( () => result.current.stayHere() );

		expect( onStartNewChat ).not.toHaveBeenCalled();
		expect( siteDetails.setSelectedSiteId ).toHaveBeenCalledOnce();
	} );
} );
