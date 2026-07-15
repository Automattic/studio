import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { useMemo, useSyncExternalStore } from 'react';
import { useConnector } from '@/data/core';
import { useAppUpdateStatus, useInstallAppUpdate } from '@/data/queries/use-app-update';

interface PersistentMessageBase {
	id: string;
	// When false the dismissal lives only in this session (used by the update
	// card when the version is unknown).
	persistDismissal?: boolean;
}

export interface StandardMessage extends PersistentMessageBase {
	intent: 'info' | 'success' | 'warning' | 'error';
	title: string;
	description?: string;
	cta?: { label: string; onClick: () => void };
}

export type PersistentMessage = StandardMessage;

export const DISMISSED_MESSAGES_QUERY_KEY = [ 'dismissed-messages' ] as const;

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

export function useActivePersistentMessages(): {
	messages: PersistentMessage[];
	dismiss: ( message: PersistentMessage ) => void;
} {
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

		return messages;
	}, [ updateStatus.data, install ] );

	const messages = useMemo(
		() => deriveActiveMessages( sources, dismissed.data ?? [], sessionIds ),
		[ sources, dismissed.data, sessionIds ]
	);

	return {
		messages,
		dismiss: ( message: PersistentMessage ) => {
			dismissMessage.mutate( message );
		},
	};
}
