import {
	ADD_PAYMENT_METHOD_URL,
	formatAiAccessRequiredHeadline,
	getStudioCodeAiAccessState,
	STUDIO_ASSISTANT_QUOTA_OFFLINE,
	STUDIO_CODE_AI_BETA_APPLY_URL,
} from '@studio/common/lib/studio-assistant-quota';
import { __ } from '@wordpress/i18n';
import { useEffect, useState } from 'react';
import { useConnector } from '@/data/core';
import { useAiSettings } from '@/data/queries/use-ai-settings';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useOpenSettings } from '@/data/use-open-settings';
import { useOffline } from '@/lib/hooks';
import type { ComposerNotice } from '@/features/composer';
import type { AiProviderId } from '@studio/agent/protocol/providers';

/**
 * Why this chat can't send right now, shown above the composer while the
 * transcript stays readable. WordPress.com requirements only apply to chats
 * on WordPress.com; the proxy stays the enforcement point, so an unknown
 * quota fails open.
 */
export function useComposerNotice( provider: AiProviderId ): ComposerNotice | undefined {
	const connector = useConnector();
	const openSettings = useOpenSettings();
	const isOffline = useOffline();
	const { data: user, isLoading: isUserLoading } = useAuthUser();
	const settings = useAiSettings();
	const quota = useStudioAssistantQuota();
	// Refetching a failed check (opening the model picker does) clears its
	// error through every retry; the failure stands until one succeeds.
	const [ settledQuotaError, setSettledQuotaError ] = useState( quota.error );
	if ( ! quota.isFetching && quota.error !== settledQuotaError ) {
		setSettledQuotaError( quota.error );
	}
	const quotaError = quota.error ?? settledQuotaError;
	// A payment method added in the browser shows up once Studio is back in
	// front, which a desktop window reports only as focus.
	const needsPaymentMethod = provider === 'wpcom' && quota.data?.hasPaymentMethod === false;
	const { refetch: refetchQuota } = quota;
	useEffect( () => {
		if ( ! needsPaymentMethod ) {
			return;
		}
		const recheck = () => void refetchQuota();
		window.addEventListener( 'focus', recheck );
		return () => window.removeEventListener( 'focus', recheck );
	}, [ needsPaymentMethod, refetchQuota ] );

	const retry = {
		label: __( 'Try again' ),
		onClick: () => {
			void settings.refetch();
			void quota.refetch();
		},
	};
	if ( isOffline ) {
		return { message: __( 'You are offline. Reconnect to send a message.' ) };
	}
	if ( quotaError?.message === STUDIO_ASSISTANT_QUOTA_OFFLINE ) {
		return { message: __( 'You are offline. Reconnect to send a message.' ), action: retry };
	}
	if ( settings.isLoading || ( provider === 'wpcom' && isUserLoading ) ) {
		return;
	}
	if ( settings.isError ) {
		return { message: __( 'Couldn’t load your AI provider.' ), action: retry };
	}
	if ( provider !== 'wpcom' ) {
		return;
	}
	const connect = { label: __( 'Connect' ), onClick: () => openSettings( 'ai' ) };
	if ( ! user ) {
		return { message: __( 'Connect a provider to build and edit your site.' ), action: connect };
	}
	if ( quotaError ) {
		return { message: __( 'AI usage is currently unavailable.' ), action: retry };
	}
	if ( ! quota.data ) {
		return;
	}
	const access = getStudioCodeAiAccessState( quota.data );
	if ( access === 'blocked' ) {
		return {
			message: __( 'Connect a different provider to continue this chat.' ),
			action: connect,
		};
	}
	if ( access === 'not-enabled' ) {
		return {
			message: formatAiAccessRequiredHeadline( quota.data ),
			action: {
				label: __( 'Apply for access' ),
				onClick: () => void connector.openExternalUrl( STUDIO_CODE_AI_BETA_APPLY_URL ),
			},
		};
	}
	if ( ! quota.data.hasPaymentMethod ) {
		return {
			message: __( 'Add a payment method to use WordPress.com AI.' ),
			action: {
				label: __( 'Set up' ),
				onClick: () => void connector.openExternalUrl( ADD_PAYMENT_METHOD_URL ),
			},
		};
	}
}
