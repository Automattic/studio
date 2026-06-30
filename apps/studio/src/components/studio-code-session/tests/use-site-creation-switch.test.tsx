// Run tests: npm test -- src/components/studio-code-session/tests/use-site-creation-switch.test.tsx
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSiteCreationSwitch } from '../use-site-creation-switch';
import type { AiSessionPlacementUpdatedEvent } from '@studio/common/ai/sessions/placement';
import type { IpcRendererEvent } from 'electron';

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
	it( 'migrates on placement: claims the new site and resets the current site to a fresh chat', () => {
		siteDetails.sites = [ { id: 'old-site' }, { id: 'new-site' } ];
		const onStartNewChat = vi.fn();
		const { result } = renderHook( () =>
			useSiteCreationSwitch( {
				sessionId: 'session-1',
				currentSiteId: 'old-site',
				onStartNewChat,
			} )
		);

		emitPlacement( placementEvent( 'session-1', 'new-site', 'My New Site' ) );

		expect( result.current.pending ).toEqual( { siteId: 'new-site', siteName: 'My New Site' } );
		// The new site claims the conversation, and the current site is moved to a
		// fresh chat immediately — not on the user's click.
		expect( readStoredMap()[ 'new-site' ] ).toBe( 'session-1' );
		expect( onStartNewChat ).toHaveBeenCalledOnce();
	} );

	it( 'ignores placement events for a different session', () => {
		const onStartNewChat = vi.fn();
		const { result } = renderHook( () =>
			useSiteCreationSwitch( {
				sessionId: 'session-1',
				currentSiteId: 'old-site',
				onStartNewChat,
			} )
		);

		emitPlacement( placementEvent( 'some-other-session', 'new-site' ) );

		expect( result.current.pending ).toBeNull();
		expect( onStartNewChat ).not.toHaveBeenCalled();
		expect( readStoredMap() ).toEqual( {} );
	} );

	it( 'ignores a placement onto the current site (no migration)', () => {
		const onStartNewChat = vi.fn();
		const { result } = renderHook( () =>
			useSiteCreationSwitch( {
				sessionId: 'session-1',
				currentSiteId: 'old-site',
				onStartNewChat,
			} )
		);

		emitPlacement( placementEvent( 'session-1', 'old-site' ) );

		expect( result.current.pending ).toBeNull();
		expect( onStartNewChat ).not.toHaveBeenCalled();
	} );

	it( 'openNewSite switches to the new site', () => {
		siteDetails.sites = [ { id: 'old-site' }, { id: 'new-site' } ];
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

	it( 'stayHere just dismisses — it does not switch or migrate again', () => {
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
		expect( onStartNewChat ).toHaveBeenCalledOnce(); // migration happened on the event

		act( () => result.current.stayHere() );

		expect( result.current.pending ).toBeNull();
		expect( siteDetails.setSelectedSiteId ).not.toHaveBeenCalled();
		// No second migration: the new chat was already started when the prompt opened.
		expect( onStartNewChat ).toHaveBeenCalledOnce();
	} );
} );
