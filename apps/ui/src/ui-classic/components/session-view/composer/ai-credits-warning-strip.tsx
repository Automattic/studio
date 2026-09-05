import {
	formatAiCreditsUsageTitle,
	getAiCreditsMeterIntent,
} from '@studio/common/lib/studio-assistant-quota';
import { AddAiCreditsButton } from '@/components/add-ai-credits-button';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { useAiCreditsMeter } from '@/hooks/use-ai-credits-meter';
import { useIsOutOfAiCredits } from '@/hooks/use-is-out-of-ai-credits';
import styles from './style.module.css';

/** Warns in the composer from 90% usage. The lockout owns 100%; the two never render together. */
export function AiCreditsWarningStrip() {
	const meter = useAiCreditsMeter();
	const isOutOfCredits = useIsOutOfAiCredits();
	const locale = useUserLocale();
	// 'exhausted' too: the meter can round up to full while credits remain.
	const intent = meter ? getAiCreditsMeterIntent( meter.fraction ) : 'ok';
	if ( ! meter || isOutOfCredits || ( intent !== 'critical' && intent !== 'exhausted' ) ) {
		return null;
	}

	return (
		<section className={ styles.aiCreditsWarningStrip } role="status">
			<span>{ formatAiCreditsUsageTitle( meter.fraction, locale ) }</span>
			<AddAiCreditsButton className={ styles.aiCreditsWarningStripButton } />
		</section>
	);
}
