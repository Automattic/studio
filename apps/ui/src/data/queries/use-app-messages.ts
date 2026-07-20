import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { useMemo } from 'react';
import { useConnector } from '@/data/core';
import { useAppUpdateStatus } from '@/data/queries/use-app-update';

export interface PersistentMessage {
	id: string;
	// When false the dismissal lives only in this session (used by the update
	// card when the version is unknown).
	persistDismissal?: boolean;
	intent: 'info' | 'success' | 'warning' | 'error';
	title: string;
	description?: string;
	cta?: { label: string; onClick: () => void };
}

const DISMISSED_MESSAGES_QUERY_KEY = [ 'dismissed-messages' ] as const;

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
		// A session-only dismissal (persistDismissal: false) relies on the cache
		// alone: the query never refetches (staleTime: Infinity) and isn't
		// persisted, so the setQueryData below is the session store.
		mutationFn: ( message: PersistentMessage ) =>
			message.persistDismissal === false
				? Promise.resolve()
				: connector.dismissMessage( message.id ),
		onMutate: ( message ) => {
			queryClient.setQueryData( DISMISSED_MESSAGES_QUERY_KEY, ( current: string[] | undefined ) =>
				current?.includes( message.id ) ? current : [ ...( current ?? [] ), message.id ]
			);
		},
	} );
}

export function useActivePersistentMessages(): {
	messages: PersistentMessage[];
	dismiss: ( message: PersistentMessage ) => void;
} {
	const connector = useConnector();
	const updateStatus = useAppUpdateStatus();
	const dismissed = useDismissedMessages();
	const dismissMessage = useDismissMessage();

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
				cta: { label: __( 'Restart now' ), onClick: () => void connector.installAppUpdate() },
			} );
		}

		return messages;
	}, [ updateStatus.data, connector ] );

	const messages = useMemo( () => {
		const dismissedIds = dismissed.data ?? [];
		return sources.filter( ( message ) => ! dismissedIds.includes( message.id ) );
	}, [ sources, dismissed.data ] );

	return {
		messages,
		dismiss: ( message: PersistentMessage ) => {
			dismissMessage.mutate( message );
		},
	};
}
