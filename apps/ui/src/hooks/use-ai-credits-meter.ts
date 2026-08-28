import {
	getAiCreditsMeter,
	getStudioCodeAiAccessState,
	type AiCreditsMeter,
} from '@studio/common/lib/studio-assistant-quota';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';

/**
 * The combined AI credits meter for the signed-in account, or null when there
 * is nothing to measure — no quota yet, an account another gate already holds,
 * or a server that reports no denominator. Null means "no figure", never an
 * empty balance: the exhausted state has its own signal in
 * `useIsOutOfAiCredits`.
 */
export function useAiCreditsMeter(): AiCreditsMeter | null {
	const { data: quota } = useStudioAssistantQuota();
	if ( ! quota || getStudioCodeAiAccessState( quota ) !== 'available' ) {
		return null;
	}
	return getAiCreditsMeter( quota );
}
