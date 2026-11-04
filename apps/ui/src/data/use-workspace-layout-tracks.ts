import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { useCallback, useLayoutEffect, useReducer, useRef } from 'react';
import { useConnector } from '@/data/core';
import type { WorkspaceLayout } from '@studio/common/types/workspace-layout';

interface LayoutState {
	layout: WorkspaceLayout;
	narrow: boolean;
	siteId?: string;
}

export function useWorkspaceLayoutTracks( state: LayoutState ) {
	const connector = useConnector();
	const current = useRef( state );
	const pending = useRef< ( LayoutState & { ready: boolean } ) | null >( null );
	const [ , flush ] = useReducer( ( value: number ) => value + 1, 0 );

	useLayoutEffect( () => {
		current.current = state;
		const transition = pending.current;
		if ( ! transition ) return;
		if ( transition.siteId !== state.siteId || transition.narrow !== state.narrow ) {
			pending.current = null;
			return;
		}
		if ( ! transition.ready ) return;
		pending.current = null;
		if ( transition.layout === state.layout ) return;
		try {
			void connector
				.trackEvent(
					TRACKS_EVENTS.WORKSPACE_LAYOUT_CHANGED,
					{ layout: state.layout },
					state.siteId
				)
				.catch( () => undefined );
		} catch {
			// Layout controls must work even when telemetry is unavailable.
		}
	} );

	return useCallback( ( update: () => void | Promise< unknown >, userInitiated = false ) => {
		if ( ! userInitiated ) {
			pending.current = null;
			void update();
			return;
		}
		// Measure the committed result, including navigation from a site's home view.
		const transition = { ...( pending.current ?? current.current ), ready: false };
		pending.current = transition;
		const complete = () => {
			if ( pending.current !== transition ) return;
			transition.ready = true;
			flush();
		};
		try {
			const result = update();
			if ( result ) {
				void result.then( complete, () => {
					if ( pending.current === transition ) pending.current = null;
				} );
			} else complete();
		} catch ( error ) {
			pending.current = null;
			throw error;
		}
	}, [] );
}
