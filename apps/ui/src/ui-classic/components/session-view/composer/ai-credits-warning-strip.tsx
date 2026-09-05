import { getAiCreditsMeterIntent } from '@studio/common/lib/studio-assistant-quota';
import { __, sprintf } from '@wordpress/i18n';
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

	// Formatted, not concatenated: the percent sign moves and changes by locale.
	const percentage = new Intl.NumberFormat( locale, {
		style: 'percent',
		maximumFractionDigits: 0,
	} ).format( meter.fraction );

	return (
		<section className={ styles.aiCreditsWarningStrip } role="status">
			<span>
				{ sprintf(
					/* translators: %s: share of the AI credit balance used, formatted as a percentage (e.g. 90%). */
					__( 'At %s usage' ),
					percentage
				) }
			</span>
			<AddAiCreditsButton className={ styles.aiCreditsWarningStripButton } />
		</section>
	);
}
