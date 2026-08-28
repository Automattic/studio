import { getAiCreditsMeterIntent } from '@studio/common/lib/studio-assistant-quota';
import { __, sprintf } from '@wordpress/i18n';
import { AddAiCreditsButton } from '@/components/add-ai-credits-button';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { useAiCreditsMeter } from '@/hooks/use-ai-credits-meter';
import { useIsOutOfAiCredits } from '@/hooks/use-is-out-of-ai-credits';
import styles from './style.module.css';

/**
 * Interrupts the composer once the balance enters its last tenth (STU-2337).
 * Deliberately silent about being blocked — that is the lockout's job, and the
 * two never render together. The 80% step belongs to the sidebar notice
 * (STU-2338), so this is the only threshold the composer itself announces.
 */
export function AiCreditsWarningStrip() {
	const meter = useAiCreditsMeter();
	const isOutOfCredits = useIsOutOfAiCredits();
	const locale = useUserLocale();
	// 'exhausted' is included on purpose: it covers the sliver where the meter
	// rounds up to full while the server balance is still above zero, which
	// would otherwise show neither the strip nor the lockout.
	const intent = meter ? getAiCreditsMeterIntent( meter.fraction ) : 'ok';
	if ( ! meter || isOutOfCredits || ( intent !== 'critical' && intent !== 'exhausted' ) ) {
		return null;
	}

	// The percent sign comes from the formatter, not the source string: its
	// position and character vary by locale (90 % in French, %90 in Turkish).
	const percentage = new Intl.NumberFormat( locale, {
		style: 'percent',
		maximumFractionDigits: 0,
	} ).format( meter.fraction );

	return (
		<section className={ styles.aiCreditsWarningStrip } role="status">
			<span>
				{ sprintf(
					/* translators: %s: share of the AI credit balance already used, formatted as a percentage (e.g. 90%). */
					__( 'At %s usage' ),
					percentage
				) }
			</span>
			<AddAiCreditsButton className={ styles.aiCreditsWarningStripButton } />
		</section>
	);
}
