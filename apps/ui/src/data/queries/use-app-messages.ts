import {
	formatAiCreditsThresholdDescription,
	formatAiCreditsUsageTitle,
	getAiCreditsMeterIntent,
	resolveAiCreditsThresholdNotice,
} from '@studio/common/lib/studio-assistant-quota';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useMemo } from 'react';
import { setDismissedAiCreditsIntent, useDismissedAiCreditsIntent } from '@/data/ai-credits-notice';
import { useConnector } from '@/data/core';
import { useAppUpdateStatus } from '@/data/queries/use-app-update';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { useAiCreditsMeter } from '@/hooks/use-ai-credits-meter';

// The sidebar announces the 80% step only. The composer strip takes 90% and
// the composer lockout takes exhaustion, so no two surfaces say the same thing.
const SIDEBAR_NOTICE_INTENTS = [ 'warning' ] as const;

export interface PersistentMessage {
	id: string;
	intent: 'info' | 'success' | 'warning' | 'error';
	title: string;
	description?: string;
	cta?: { label: string; onClick: () => void };
	// Renders the app's shared purchase button in place of a plain CTA, so a
	// notice can't drift from the one entry point that knows whether to open
	// the amount picker or go straight to checkout.
	purchaseCta?: boolean;
	// A dismissal the message owns. The AI credits notice re-arms on its own
	// terms; the generic id list would keep it hidden for the whole session.
	onDismiss?: () => void;
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
	const locale = useUserLocale();
	const aiCreditsMeter = useAiCreditsMeter();
	const dismissedAiCreditsIntent = useDismissedAiCreditsIntent();
	const { data: dismissedIds = [] } = useQuery( {
		queryKey: DISMISSED_MESSAGES_QUERY_KEY,
		queryFn: () => [] as string[],
		staleTime: Infinity,
		meta: { persist: false },
	} );

	const aiCreditsFraction = aiCreditsMeter?.fraction ?? null;
	const aiCreditsIntent =
		aiCreditsFraction === null ? null : getAiCreditsMeterIntent( aiCreditsFraction );
	const aiCreditsNotice = resolveAiCreditsThresholdNotice(
		aiCreditsIntent,
		dismissedAiCreditsIntent,
		SIDEBAR_NOTICE_INTENTS
	);

	// Drop a dismissal the current usage has left behind, so the notice can
	// fire again if the account returns to that threshold.
	useEffect( () => {
		setDismissedAiCreditsIntent( aiCreditsNotice.dismissedIntent );
	}, [ aiCreditsNotice.dismissedIntent ] );

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

		if ( aiCreditsNotice.visible && aiCreditsIntent && aiCreditsFraction !== null ) {
			messages.push( {
				id: `ai-credits:${ aiCreditsIntent }`,
				intent: 'warning',
				title: formatAiCreditsUsageTitle( aiCreditsFraction, locale ),
				description: formatAiCreditsThresholdDescription(),
				purchaseCta: true,
				onDismiss: () => setDismissedAiCreditsIntent( aiCreditsIntent ),
			} );
		}

		return messages;
	}, [
		updateStatus.data,
		connector,
		aiCreditsIntent,
		aiCreditsFraction,
		aiCreditsNotice.visible,
		locale,
	] );

	const messages = useMemo(
		() => sources.filter( ( message ) => ! dismissedIds.includes( message.id ) ),
		[ sources, dismissedIds ]
	);

	return {
		messages,
		dismiss: ( message: PersistentMessage ) => {
			if ( message.onDismiss ) {
				message.onDismiss();
				return;
			}
			queryClient.setQueryData( DISMISSED_MESSAGES_QUERY_KEY, ( current: string[] | undefined ) =>
				current?.includes( message.id ) ? current : [ ...( current ?? [] ), message.id ]
			);
		},
	};
}
