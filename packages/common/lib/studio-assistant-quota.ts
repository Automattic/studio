import { __, sprintf } from '@wordpress/i18n';
import { z } from 'zod';

export const STUDIO_ASSISTANT_QUOTA_URL =
	'https://public-api.wordpress.com/wpcom/v2/studio-app/ai-assistant/quota';

export const ADD_PAYMENT_METHOD_URL = 'https://my.wordpress.com/me/billing/payment-methods/add';

export const WPCOM_SUPPORT_CONTACT_URL = 'https://wordpress.com/support/contact/';

export const studioAssistantQuotaSchema = z
	.object( {
		cost_usage: z.number(),
		cost_cap: z.number(),
		cost_reset_date: z.string(),
		// Entitlement gates (STU-2174); older servers omit both fields. Default to
		// true so a stale server never locks the UI — the proxy still enforces.
		email_verified: z.boolean().optional(),
		has_payment_method: z.boolean().optional(),
		// Semi-open beta access (STU-2146); older servers omit the fields.
		// `studio_code_ai_has_access` is the policy outcome the AI proxy
		// enforces; `studio_code_ai_access` is the raw per-user decision
		// ("granted" | "blocked" | "default" — kept as a plain string so new
		// server-side values never fail the parse).
		studio_code_ai_has_access: z.boolean().optional(),
		studio_code_ai_access: z.string().optional(),
	} )
	.transform( ( data ) => ( {
		costUsage: data.cost_usage,
		costCap: data.cost_cap,
		costResetDate: data.cost_reset_date,
		emailVerified: data.email_verified ?? true,
		hasPaymentMethod: data.has_payment_method ?? true,
		studioCodeAiHasAccess: data.studio_code_ai_has_access,
		studioCodeAiAccess: data.studio_code_ai_access,
	} ) );

export type StudioAssistantQuota = z.infer< typeof studioAssistantQuotaSchema >;

export type StudioCodeAiAccessState = 'available' | 'blocked' | 'not-enabled';

/**
 * Collapse the quota's access fields into the three UI states of the
 * semi-open beta (STU-2146). Gates on `studioCodeAiHasAccess` first — the
 * policy outcome the AI proxy enforces — and only consults the raw per-user
 * decision to tell an explicit block apart from a not-yet-enabled default.
 * Anything but an explicit `false` counts as available (older servers omit
 * the field, and enforcement lives in the proxy), so a future default-allow
 * flip needs no client change.
 */
export function getStudioCodeAiAccessState(
	quota: Pick< StudioAssistantQuota, 'studioCodeAiHasAccess' | 'studioCodeAiAccess' >
): StudioCodeAiAccessState {
	if ( quota.studioCodeAiHasAccess !== false ) {
		return 'available';
	}
	return quota.studioCodeAiAccess === 'blocked' ? 'blocked' : 'not-enabled';
}

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
 * User-facing copy for an account whose Studio Code AI access was explicitly
 * blocked (access === "blocked", STU-2143/STU-2146). Shared by every surface
 * so the wording stays consistent. The string wraps the support
 * call-to-action in a `<supportLink>` token: render it with
 * `createInterpolateElement`, pointing the token at
 * `WPCOM_SUPPORT_CONTACT_URL` — or at a plain `<span />` on surfaces that
 * show their own support button.
 */
export function formatAiBlockedNotice(): string {
	return __(
		/* translators: <supportLink> and </supportLink> wrap the link to WordPress.com support and must be kept as-is. */
		'Studio Code AI is blocked for this WordPress.com account. If you believe this is a mistake, <supportLink>contact WordPress.com support</supportLink>.'
	);
}

export const STUDIO_CODE_AI_BETA_APPLY_URL =
	'https://developer.wordpress.com/studio/studio-code-beta/';

/**
 * Headline sentence for an account that hasn't been granted Studio Code AI
 * beta access yet (STU-2146), without an apply CTA — for surfaces that render
 * their own action button (e.g. the AccessRequirements gate). Spend on the
 * quota means the account has demonstrably used Studio Code AI this billing
 * cycle (the backend keeps reporting the real month total after access flips
 * off), so those users read that the requirement is new rather than that the
 * feature never existed for them.
 */
export function formatAiAccessRequiredHeadline(
	quota?: Pick< StudioAssistantQuota, 'costUsage' > | null
): string {
	if ( quota && quota.costUsage > 0 ) {
		return __( 'Thanks for participating in the Studio Code AI beta. Access is now limited.' );
	}
	return __( 'Studio Code AI is currently available through limited beta access.' );
}

/**
 * Full inline notice for an account without Studio Code AI beta access:
 * the headline above followed by an apply sentence. Deliberately distinct
 * from the blocked notice — nothing is wrong with the account; access just
 * hasn't been enabled. The apply sentence wraps the application URL in an
 * `<applyLink>` token: render it with `createInterpolateElement`, pointing
 * the token at `STUDIO_CODE_AI_BETA_APPLY_URL`.
 */
export function formatAiAccessRequiredNotice(
	quota?: Pick< StudioAssistantQuota, 'costUsage' > | null
): string {
	const applySentence =
		quota && quota.costUsage > 0
			? __(
					/* translators: <applyLink> and </applyLink> wrap the beta application URL and must be kept as-is. */
					'Apply to continue at <applyLink>developer.wordpress.com/studio/studio-code-beta</applyLink>.'
			  )
			: __(
					/* translators: <applyLink> and </applyLink> wrap the beta application URL and must be kept as-is. */
					'Apply at <applyLink>developer.wordpress.com/studio/studio-code-beta</applyLink>.'
			  );
	return `${ formatAiAccessRequiredHeadline( quota ) } ${ applySentence }`;
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
