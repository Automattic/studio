import { getStudioCodeAiAccessState } from '@studio/common/lib/studio-assistant-quota';
import { useGetStudioAssistantQuota } from 'src/stores/wpcom-api';

/**
 * Whether the account has spent both AI credit pools and can't send another
 * prompt until it buys more (STU-2236).
 *
 * Fails open in every uncertain case — no quota yet, an account the server
 * doesn't report pools for (the older monthly-cap design, where a zero
 * balance means nothing), or an account already held by another gate. The
 * WordPress.com proxy enforces the real limit; this only decides whether to
 * offer the composer or the purchase card in its place.
 */
export function useIsOutOfAiCredits(): boolean {
	const { data: quota } = useGetStudioAssistantQuota();
	if ( ! quota || getStudioCodeAiAccessState( quota ) !== 'available' ) {
		return false;
	}
	if ( quota.allowanceRemaining === undefined && quota.purchasedRemaining === undefined ) {
		return false;
	}
	return ( quota.allowanceRemaining ?? 0 ) + ( quota.purchasedRemaining ?? 0 ) <= 0;
}
