import { __, sprintf } from '@wordpress/i18n';
import { z } from 'zod';

export const STUDIO_ASSISTANT_QUOTA_URL =
	'https://public-api.wordpress.com/wpcom/v2/studio-app/ai-assistant/quota';

export const ADD_PAYMENT_METHOD_URL = 'https://my.wordpress.com/me/billing/payment-methods/add';

export const studioAssistantQuotaSchema = z
	.object( {
		cost_usage: z.number(),
		cost_cap: z.number(),
		cost_reset_date: z.string(),
		// Per-user kill switch (STU-2143); older servers omit the field.
		is_studio_code_ai_blocked: z.boolean().optional(),
		// Entitlement gates (STU-2174); older servers omit both fields. Default to
		// true so a stale server never locks the UI — the proxy still enforces.
		email_verified: z.boolean().optional(),
		has_payment_method: z.boolean().optional(),
	} )
	.transform( ( data ) => ( {
		costUsage: data.cost_usage,
		costCap: data.cost_cap,
		costResetDate: data.cost_reset_date,
		isStudioCodeAiBlocked: data.is_studio_code_ai_blocked ?? false,
		emailVerified: data.email_verified ?? true,
		hasPaymentMethod: data.has_payment_method ?? true,
	} ) );

export type StudioAssistantQuota = z.infer< typeof studioAssistantQuotaSchema >;

/**
 * Fetch the account's Studio AI quota from WordPress.com. Resolves `null` on
 * any failure (network, auth, unexpected shape) so callers can fall back to
 * static copy.
 */
export async function fetchStudioAssistantQuota(
	accessToken: string
): Promise< StudioAssistantQuota | null > {
	try {
		const response = await fetch( STUDIO_ASSISTANT_QUOTA_URL, {
			headers: { Authorization: `Bearer ${ accessToken }` },
		} );
		if ( ! response.ok ) {
			return null;
		}
		return studioAssistantQuotaSchema.parse( await response.json() );
	} catch {
		return null;
	}
}

export function clampQuotaFraction( value: number, maxValue: number ): number {
	return maxValue > 0 ? Math.max( 0, Math.min( 1, value / maxValue ) ) : 0;
}

export function formatQuotaPercentage( fraction: number, locale?: string ): string {
	return new Intl.NumberFormat( locale, {
		style: 'percent',
		maximumFractionDigits: 2,
	} ).format( fraction );
}

export function formatQuotaResetDate( date: string, locale?: string ): string {
	return new Intl.DateTimeFormat( locale, {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
	} ).format( new Date( date ) );
}

/**
 * User-facing copy for the per-account Studio Code AI kill switch (STU-2143).
 * Shared by every surface so the wording stays consistent.
 */
export function formatAiBlockedNotice(): string {
	return __(
		'Studio Code AI is unavailable for this WordPress.com account. If you believe this is a mistake, contact WordPress.com support.'
	);
}

/**
 * User-facing copy for hitting the monthly AI usage cap. Shared by every
 * surface (CLI, desktop, browser UI) so the wording stays consistent. Pass
 * the quota's reset date when known to make the copy actionable.
 */
export function formatUsageCapNotice( resetDate?: string | null, locale?: string ): string {
	if ( resetDate ) {
		return sprintf(
			/* translators: %s: date the monthly AI usage limit resets (e.g. August 1, 2026). */
			__( 'You’ve reached your monthly AI usage limit. It resets on %s.' ),
			formatQuotaResetDate( resetDate, locale )
		);
	}
	return __( 'You’ve reached your monthly AI usage limit. Try again later.' );
}
