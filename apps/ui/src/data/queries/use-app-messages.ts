import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { useMemo, useSyncExternalStore } from 'react';
import { ANNOUNCEMENTS, getActiveAnnouncements } from '@/data/announcements';
import { useConnector } from '@/data/core';
import { useAppUpdateStatus, useInstallAppUpdate } from '@/data/queries/use-app-update';

// Persistent messages ("cards") shown in the sidebar footer: condition-driven
// rather than fire-and-forget — an app update waiting to install, a running
// promotion. Sources are composed here; rendering lives in
// components/app-message-cards.

export interface PersistentMessage {
	// Stable id; doubles as the dismissal key.
	id: string;
	intent: 'info' | 'success' | 'warning' | 'error';
	title: string;
	description?: string;
	cta?: { label: string; onClick: () => void };
	// When false the dismissal lives only in this session (used by the
	// update card when the version is unknown, so a persisted dismissal can
	// never hide a future update).
	persistDismissal?: boolean;
}

export const DISMISSED_MESSAGES_QUERY_KEY = [ 'dismissed-messages' ] as const;

// Session-only dismissals for messages with `persistDismissal: false`.
const sessionDismissed = new Set< string >();
const sessionListeners = new Set< () => void >();
let sessionSnapshot: readonly string[] = [];

function dismissForSession( id: string ) {
	sessionDismissed.add( id );
	sessionSnapshot = [ ...sessionDismissed ];
	for ( const listener of sessionListeners ) {
		listener();
	}
}

function subscribeSessionDismissed( listener: () => void ): () => void {
	sessionListeners.add( listener );
	return () => {
		sessionListeners.delete( listener );
	};
}

export function useDismissedMessages() {
	const connector = useConnector();
	return useQuery( {
		queryKey: DISMISSED_MESSAGES_QUERY_KEY,
		queryFn: () => connector.getDismissedMessages(),
		staleTime: Infinity,
		meta: { persist: false },
	} );
}

export function useDismissMessage() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( message: PersistentMessage ) => {
			if ( message.persistDismissal === false ) {
				dismissForSession( message.id );
				return Promise.resolve();
			}
			return connector.dismissMessage( message.id );
		},
		// Optimistic append so the card leaves immediately.
		onMutate: ( message ) => {
			if ( message.persistDismissal === false ) {
				return;
			}
			queryClient.setQueryData( DISMISSED_MESSAGES_QUERY_KEY, ( current: string[] | undefined ) =>
				current?.includes( message.id ) ? current : [ ...( current ?? [] ), message.id ]
			);
		},
	} );
}

// Pure so the filtering is unit-testable without hooks.
export function deriveActiveMessages(
	sources: PersistentMessage[],
	dismissedIds: readonly string[],
	sessionDismissedIds: readonly string[]
): PersistentMessage[] {
	return sources.filter(
		( message ) =>
			! dismissedIds.includes( message.id ) && ! sessionDismissedIds.includes( message.id )
	);
}

/**
 * All currently-active persistent messages, sources minus dismissals, plus
 * the dismiss handler the cards call.
 */
export function useActivePersistentMessages(): {
	messages: PersistentMessage[];
	dismiss: ( message: PersistentMessage ) => void;
} {
	const connector = useConnector();
	const updateStatus = useAppUpdateStatus();
	const installUpdate = useInstallAppUpdate();
	const dismissed = useDismissedMessages();
	const dismissMessage = useDismissMessage();
	const sessionIds = useSyncExternalStore(
		subscribeSessionDismissed,
		() => sessionSnapshot,
		() => sessionSnapshot
	);

	const install = installUpdate.mutate;

	const sources = useMemo( () => {
		const messages: PersistentMessage[] = [];

		if ( updateStatus.data?.readyToInstall ) {
			const version = updateStatus.data.version;
			messages.push( {
				// Version-scoped id so a dismissal re-arms for the next release.
				id: version ? `app-update:${ version }` : 'app-update',
				persistDismissal: !! version,
				intent: 'info',
				title: version
					? sprintf(
							/* translators: %s: app version number. */
							__( 'Studio %s is ready to install' ),
							version
					  )
					: __( 'A Studio update is ready to install' ),
				description: __( 'Restart to finish updating.' ),
				cta: { label: __( 'Restart now' ), onClick: () => install() },
			} );
		}

		for ( const announcement of getActiveAnnouncements( ANNOUNCEMENTS, new Date() ) ) {
			messages.push( {
				id: announcement.id,
				intent: announcement.intent ?? 'info',
				title: announcement.title,
				description: announcement.description,
				cta: announcement.cta
					? {
							label: announcement.cta.label,
							onClick: () => void connector.openExternalUrl( announcement.cta!.url ),
					  }
					: undefined,
			} );
		}

		return messages;
	}, [ updateStatus.data, install, connector ] );

	const messages = useMemo(
		() => deriveActiveMessages( sources, dismissed.data ?? [], sessionIds ),
		[ sources, dismissed.data, sessionIds ]
	);

	return {
		messages,
		dismiss: ( message: PersistentMessage ) => dismissMessage.mutate( message ),
	};
}
