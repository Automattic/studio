import {
	getAiCreditsMeter,
	getStudioCodeAiAccessState,
	type AiCreditsMeter,
} from '@studio/common/lib/studio-assistant-quota';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';

/** Null means there is no figure to show, not an empty balance — see `useIsOutOfAiCredits` for that. */
export function useAiCreditsMeter(): AiCreditsMeter | null {
	const { data: quota } = useStudioAssistantQuota();
	if ( ! quota || getStudioCodeAiAccessState( quota ) !== 'available' ) {
		return null;
	}
	return getAiCreditsMeter( quota );
}
