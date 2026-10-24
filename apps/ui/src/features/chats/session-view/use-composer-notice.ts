import {
	ADD_PAYMENT_METHOD_URL,
	formatAiAccessRequiredHeadline,
	getStudioCodeAiAccessState,
	STUDIO_ASSISTANT_QUOTA_OFFLINE,
	STUDIO_CODE_AI_BETA_APPLY_URL,
} from '@studio/common/lib/studio-assistant-quota';
import { __ } from '@wordpress/i18n';
import { useConnector } from '@/data/core';
import { useAiSettings } from '@/data/queries/use-ai-settings';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useOpenSettings } from '@/features/settings';
import { useOffline } from '@/lib/hooks';
import type { ComposerNotice } from './composer';
import type { AiProviderId } from '@studio/common/ai/providers';

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
	if ( quota.error?.message === STUDIO_ASSISTANT_QUOTA_OFFLINE ) {
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
	if ( quota.isError ) {
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
