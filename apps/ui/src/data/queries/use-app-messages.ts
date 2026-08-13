import { useQuery, useQueryClient } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { useMemo } from 'react';
import { openPurchaseCreditsDialog } from '@/components/purchase-credits-dialog/events';
import { useConnector } from '@/data/core';
import { useAppUpdateStatus } from '@/data/queries/use-app-update';
import { useUsageExploration } from '@/data/usage-exploration';

export interface PersistentMessage {
	id: string;
	intent: 'info' | 'success' | 'warning' | 'error';
	title: string;
	description?: string;
	cta?: { label: string; onClick: () => void };
}

// Dismissals are session-only by design: the cache entry isn't persisted and
// never refetches, so it lives until the app restarts — and restarting installs
// the pending update, which removes the card's reason to exist. If a future
// message must outlive restarts (e.g. server announcements), that's the point
// to add persisted dismissal storage.
const DISMISSED_MESSAGES_QUERY_KEY = [ 'dismissed-messages' ] as const;

export function useActivePersistentMessages(): {
	messages: PersistentMessage[];
	dismiss: ( message: PersistentMessage ) => void;
} {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const updateStatus = useAppUpdateStatus();
	const usage = useUsageExploration();
	const { data: dismissedIds = [] } = useQuery( {
		queryKey: DISMISSED_MESSAGES_QUERY_KEY,
		queryFn: () => [] as string[],
		staleTime: Infinity,
		meta: { persist: false },
	} );

	const sources = useMemo( () => {
		const messages: PersistentMessage[] = [];

		if ( updateStatus.data?.readyToInstall ) {
			const version = updateStatus.data.version;
			messages.push( {
				// Version-scoped id so a dismissal re-arms for the next release.
				id: version ? `app-update:${ version }` : 'app-update',
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

		const activeUsageFraction = usage.combinedFraction;
		const usagePercentage = Math.round( activeUsageFraction * 100 );
		const usageTitle = sprintf(
			/* translators: %s: percentage of the active AI credit pool used. */
			__( 'At %s%% usage' ),
			String( usagePercentage )
		);

		if ( ! usage.isExhausted && activeUsageFraction >= 0.9 ) {
			messages.push( {
				id: 'ai-credits:critical',
				intent: 'warning',
				title: usageTitle,
				description: __( 'Add AI credits to keep chatting without interruption.' ),
				cta: { label: __( 'Add AI credits' ), onClick: openPurchaseCreditsDialog },
			} );
		} else if ( ! usage.isExhausted && activeUsageFraction >= 0.8 ) {
			messages.push( {
				id: 'ai-credits:warning',
				intent: 'warning',
				title: usageTitle,
				description: __( 'Add AI credits to keep chatting without interruption.' ),
				cta: { label: __( 'Add AI credits' ), onClick: openPurchaseCreditsDialog },
			} );
		}

		return messages;
	}, [ updateStatus.data, connector, usage ] );

	const messages = useMemo(
		() => sources.filter( ( message ) => ! dismissedIds.includes( message.id ) ),
		[ sources, dismissedIds ]
	);

	return {
		messages,
		dismiss: ( message: PersistentMessage ) => {
			queryClient.setQueryData( DISMISSED_MESSAGES_QUERY_KEY, ( current: string[] | undefined ) =>
				current?.includes( message.id ) ? current : [ ...( current ?? [] ), message.id ]
			);
		},
	};
}
