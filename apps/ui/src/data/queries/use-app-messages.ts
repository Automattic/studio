import {
	formatAiCreditsThresholdDescription,
	formatAiCreditsUsageTitle,
	getAiCreditsMeterIntent,
	resolveAiCreditsThresholdNotice,
} from '@studio/common/lib/studio-assistant-quota';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { useEffect, useMemo } from 'react';
import { setDismissedAiCreditsIntent, useDismissedAiCreditsIntent } from '@/data/ai-credits-notice';
import { DISMISSED_MESSAGES_QUERY_KEY, type ToastAction } from '@/data/app-messages';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { useAiCreditsMeter } from './use-ai-credits-meter';

// The sidebar announces the 80% and 90% steps. The composer notice takes
// exhaustion, so no two surfaces say the same thing.
const SIDEBAR_NOTICE_INTENTS = [ 'warning', 'critical' ] as const;

export interface PersistentMessage {
	id: string;
	intent: 'info' | 'success' | 'warning' | 'error';
	title: string;
	description?: string;
	action?: ToastAction;
	// Renders the app's shared purchase button in place of an action, so a
	// notice can't drift from the one entry point that knows whether to open
	// the amount picker or go straight to checkout.
	purchaseCta?: boolean;
	// A dismissal the message owns. The AI credits notice re-arms on its own
	// terms; the generic id list would keep it hidden for the whole session.
	onDismiss?: () => void;
}

// Dismissals are session-only: the cache entry isn't persisted and never refetches.

// Before session dismissals are applied.
function usePersistentMessageSources(): PersistentMessage[] {
	const locale = useUserLocale();
	const aiCreditsMeter = useAiCreditsMeter();
	const dismissedAiCreditsIntent = useDismissedAiCreditsIntent();

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

	return useMemo( () => {
		const messages: PersistentMessage[] = [];

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
	}, [ aiCreditsIntent, aiCreditsFraction, aiCreditsNotice.visible, locale ] );
}

export function useActivePersistentMessages(): {
	messages: PersistentMessage[];
	dismiss: ( message: PersistentMessage ) => void;
} {
	const queryClient = useQueryClient();
	const sources = usePersistentMessageSources();
	const { data: dismissedIds = [] } = useQuery( {
		queryKey: DISMISSED_MESSAGES_QUERY_KEY,
		queryFn: () => [] as string[],
		staleTime: Infinity,
		meta: { persist: false },
	} );

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
