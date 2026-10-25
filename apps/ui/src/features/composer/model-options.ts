import {
	clampQuotaFraction,
	formatQuotaPercentage,
	getTotalRemainingAiCredits,
	type StudioAssistantQuota,
} from '@studio/common/lib/studio-assistant-quota';
import { __, sprintf } from '@wordpress/i18n';
import type { AiModelId } from '@/data/core';

export function getModelDescription( id: AiModelId ): string {
	switch ( id ) {
		case 'fast':
			return __( 'Quick fixes and questions' );
		case 'balanced':
		case 'claude-sonnet-5':
			return __( 'Build features, style pages, and fix bugs' );
		case 'strong':
		case 'claude-opus-5':
			return __( 'Plan complex builds and solve harder problems' );
		default:
			return '';
	}
}

// Accounts on the older monthly cap have no credit counts, only usage against the cap.
export function getCreditsLabel( quota: StudioAssistantQuota | null | undefined, locale?: string ) {
	const remaining = quota ? getTotalRemainingAiCredits( quota ) : undefined;
	if ( remaining !== undefined ) {
		return {
			hasCredits: true,
			label:
				remaining <= 0
					? __( 'No AI credits remaining' )
					: sprintf(
							/* translators: %s: compact number of AI credits remaining (e.g. 200K or 1.5M). */
							__( 'AI credits: %s remaining' ),
							new Intl.NumberFormat( locale, {
								notation: 'compact',
								maximumFractionDigits: 1,
							} ).format( remaining )
					  ),
		};
	}
	if ( ! quota || quota.costCap <= 0 ) {
		return { hasCredits: false, label: __( 'AI usage unavailable' ) };
	}
	return {
		hasCredits: false,
		label: sprintf(
			/* translators: %s: percentage of the AI allowance left. */
			__( 'AI allowance: %s remaining' ),
			formatQuotaPercentage( 1 - clampQuotaFraction( quota.costUsage, quota.costCap ), locale )
		),
	};
}
