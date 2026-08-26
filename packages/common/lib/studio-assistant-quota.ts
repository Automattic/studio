import { __, sprintf } from '@wordpress/i18n';
import { z } from 'zod';

export const STUDIO_ASSISTANT_QUOTA_URL =
	'https://public-api.wordpress.com/wpcom/v2/studio-app/ai-assistant/quota';

export const ADD_PAYMENT_METHOD_URL = 'https://my.wordpress.com/me/billing/payment-methods/add';

export const WPCOM_SUPPORT_CONTACT_URL = 'https://wordpress.com/support/contact/';

// Deeplink host checkout returns to once the top-up completes or is cancelled,
// handled by `ai-credits-purchased` in the desktop deeplink router. Checkout
// builds the full `wp-studio://` URL itself, so only the host travels in the
// `studioReturnTo` parameter.
export const AI_CREDITS_PURCHASED_RETURN_TO = 'ai-credits-purchased';

// Checkout wants a site id alongside the return destination, but a credits
// top-up isn't tied to a site — this placeholder satisfies the parameter
// without pointing anywhere.
const CHECKOUT_PLACEHOLDER_SITE_ID = 'b4b08783-91cd-4aa1-b2ee-28575c26a762';

// WordPress.com checkout for a Studio Code AI credits top-up (STU-2299). The
// `:-q-<n>` suffix is checkout's quantity syntax, in the same 1/10000 USD units
// the quota reports — 100000 is the $10 top-up.
const ADD_AI_CREDITS_CHECKOUT_URL = 'https://wordpress.com/checkout/wpcom/studio-code-ai-credits';

// Quantity used wherever a surface offers a single top-up rather than the
// priced options from `/top-up-pricing` (STU-2326).
export const DEFAULT_AI_CREDITS_TOP_UP = 100000;

// Bare by default: checkout stays on WordPress.com when it's done.
export const ADD_AI_CREDITS_URL = `${ ADD_AI_CREDITS_CHECKOUT_URL }:-q-${ DEFAULT_AI_CREDITS_TOP_UP }`;

/**
 * Checkout URL for the surface the user is buying from. Only the desktop app
 * registers the `wp-studio://` scheme, so only it may ask checkout to send the
 * user back — the CLI has nothing to return to (see the OAuth flow, which uses
 * a copy/paste page there for the same reason), and pointing a plain browser
 * at an unopenable scheme is worse than leaving the user on WordPress.com.
 * Everywhere else gets the bare URL, down to the return-only site id.
 */
export function getAddAiCreditsUrl( {
	returnsToDesktop,
	credits = DEFAULT_AI_CREDITS_TOP_UP,
}: {
	returnsToDesktop: boolean;
	credits?: number;
} ): string {
	const url = `${ ADD_AI_CREDITS_CHECKOUT_URL }:-q-${ credits }`;
	if ( ! returnsToDesktop ) {
		return url;
	}
	return (
		`${ url }?studioSiteId=${ CHECKOUT_PLACEHOLDER_SITE_ID }` +
		`&studioReturnTo=${ AI_CREDITS_PURCHASED_RETURN_TO }`
	);
}

export const studioAssistantQuotaSchema = z
	.object( {
		cost_usage: z.number(),
		cost_cap: z.number(),
		// Optional on purpose: the monthly reset is being retired server-side and
		// the field is currently a hardcoded stand-in, so it can disappear from the
		// response at any time. Every surface must read it as "reset date unknown"
		// and drop the reset sentence rather than break.
		cost_reset_date: z.string().optional(),
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
		// Remaining AI credits per pool (STU-2235). The server omits both fields
		// when the AI Credits feature is off for the account — the UI keys the
		// credit-balance design off their presence, so `undefined` (not 0) must
		// mean "feature off, keep the old design".
		//
		// `purchased_remaining` also arrives as null when billing is
		// unreachable. That is "unknown", not zero, and both read as "no
		// figure to show" — so null normalizes to undefined below rather than
		// failing the whole parse and taking the access gates down with it.
		allowance_remaining: z.number().optional(),
		purchased_remaining: z.number().nullish(),
		// Size of the purchased pool as of the last top-up: what was left then,
		// plus what was bought. The denominator for `purchased_remaining`, the
		// way `cost_cap` is for `allowance_remaining` — not a lifetime total,
		// so it can legitimately fall after a purchase. Omitted by older
		// servers; 0 means the account has never bought credits, which is "no
		// pool", not an empty one — never divide by it.
		purchased_at_top_up: z.number().nullish(),
	} )
	.transform( ( data ) => ( {
		costUsage: data.cost_usage,
		costCap: data.cost_cap,
		costResetDate: data.cost_reset_date,
		emailVerified: data.email_verified ?? true,
		hasPaymentMethod: data.has_payment_method ?? true,
		studioCodeAiHasAccess: data.studio_code_ai_has_access,
		studioCodeAiAccess: data.studio_code_ai_access,
		allowanceRemaining: data.allowance_remaining,
		purchasedRemaining: data.purchased_remaining ?? undefined,
		purchasedAtTopUp: data.purchased_at_top_up ?? undefined,
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
 * The combined AI credits meter (STU-2326): one bar over both pools, free and
 * purchased. Each pool contributes its own denominator — `costCap` for the
 * free allowance, `purchasedAtTopUp` for the purchased pool — and a pool
 * stays out of the meter entirely when it has nothing to measure:
 *
 * - `purchasedAtTopUp` of 0/undefined means the account has never bought
 *   credits — there is no purchased pool, not an empty one.
 * - `purchasedRemaining` undefined with a real pool means billing was
 *   unreachable — the balance is unknown, and folding it in would draw the
 *   pool as fully spent.
 *
 * Resolves `null` when nothing is measurable (feature off, or no usable
 * denominator) so callers fall back to plain figures instead of a bar.
 */
export interface AiCreditsMeter {
	usedCredits: number;
	totalCredits: number;
	remainingCredits: number;
	fraction: number;
}

export function getAiCreditsMeter(
	quota: Pick<
		StudioAssistantQuota,
		'costCap' | 'allowanceRemaining' | 'purchasedRemaining' | 'purchasedAtTopUp'
	>
): AiCreditsMeter | null {
	let totalCredits = 0;
	let remainingCredits = 0;
	const purchasedAtTopUp = quota.purchasedAtTopUp ?? 0;
	const hasPurchasedPool = purchasedAtTopUp > 0 && quota.purchasedRemaining !== undefined;
	// A spent welcome allowance drops out of the meter once a purchased pool
	// can be measured instead: right after a top-up the bar should read as the
	// fresh purchase, not as mostly-consumed because the old gift still counts
	// against the total. Without a purchased pool the spent allowance stays —
	// it is the only thing left to draw, and it reads as the full exhausted
	// bar rather than no bar at all.
	if (
		quota.allowanceRemaining !== undefined &&
		quota.costCap > 0 &&
		( quota.allowanceRemaining > 0 || ! hasPurchasedPool )
	) {
		totalCredits += quota.costCap;
		remainingCredits += quota.allowanceRemaining;
	}
	if ( hasPurchasedPool ) {
		totalCredits += purchasedAtTopUp;
		remainingCredits += quota.purchasedRemaining ?? 0;
	}
	if ( totalCredits <= 0 ) {
		return null;
	}
	const usedCredits = Math.max( 0, totalCredits - remainingCredits );
	return {
		usedCredits,
		totalCredits,
		remainingCredits,
		fraction: clampQuotaFraction( usedCredits, totalCredits ),
	};
}

export type AiCreditsMeterIntent = 'ok' | 'warning' | 'critical' | 'exhausted';

/** Escalation steps for the meter's color and copy. */
export function getAiCreditsMeterIntent( fraction: number ): AiCreditsMeterIntent {
	if ( fraction >= 1 ) {
		return 'exhausted';
	}
	if ( fraction >= 0.9 ) {
		return 'critical';
	}
	if ( fraction >= 0.8 ) {
		return 'warning';
	}
	return 'ok';
}

export function formatAiCreditsUsedLabel(
	meter: Pick< AiCreditsMeter, 'usedCredits' | 'totalCredits' >,
	locale?: string
): string {
	const credits = new Intl.NumberFormat( locale );
	return sprintf(
		/* translators: 1: AI credits used (e.g. 1,200,000). 2: total AI credits the meter is measured against (e.g. 1,500,000). */
		__( '%1$s of %2$s AI credits used' ),
		credits.format( meter.usedCredits ),
		credits.format( meter.totalCredits )
	);
}

export function formatAiCreditsAvailableLabel(
	meter: Pick< AiCreditsMeter, 'remainingCredits' >,
	locale?: string
): string {
	return sprintf(
		/* translators: %s: number of AI credits still available (e.g. 300,000). */
		__( '%s available' ),
		new Intl.NumberFormat( locale ).format( meter.remainingCredits )
	);
}

/**
 * Encouragement line next to the "Add AI credits" button, escalating with the
 * meter. The welcome line shows the size of the free allowance (`costCap`,
 * never a hardcoded figure) and only while some of it is left — an account
 * that has bought credits, or spent the gift, gets the regular rotation.
 */
export function formatAiCreditsCallout(
	quota: Pick< StudioAssistantQuota, 'costCap' | 'allowanceRemaining' | 'purchasedAtTopUp' >,
	meter: Pick< AiCreditsMeter, 'fraction' >,
	locale?: string
): string {
	switch ( getAiCreditsMeterIntent( meter.fraction ) ) {
		case 'exhausted':
			return __( 'Your next idea is ready when you are. Top up to bring it to life.' );
		case 'critical':
			return __( 'You’re on a roll. Top up now and keep building.' );
		case 'warning':
			return __( 'Top up now so your next build doesn’t stop short.' );
	}
	if ( ( quota.purchasedAtTopUp ?? 0 ) === 0 && ( quota.allowanceRemaining ?? 0 ) > 0 ) {
		return sprintf(
			/* translators: %s: size of the free AI credits allowance (e.g. 1,500,000). */
			__( 'Your first %s AI credits are on us.' ),
			new Intl.NumberFormat( locale ).format( quota.costCap )
		);
	}
	return __( 'Keep the ideas flowing. Stock up for whatever you build next.' );
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

/**
 * User-facing copy for having exhausted both AI credit pools — the free
 * monthly allowance and purchased credits (STU-2236). Shared by every surface
 * so the wording stays consistent. Deliberately never mentions the monthly
 * reset: unlike the usage cap, waiting doesn't fix this state — buying
 * credits does.
 */
export function formatOutOfCreditsNotice(): string {
	return __( 'You’re out of AI credits. Add more credits to continue using Studio Code.' );
}

/**
 * Heading for the out-of-credits card on surfaces that render a title and a
 * purchase button separately, rather than the one-sentence notice above.
 */
export function formatOutOfCreditsTitle(): string {
	return __( 'No AI credits available' );
}

/** Body of that card: what happened, and what fixes it. */
export function formatOutOfCreditsDescription(): string {
	return __( 'You’ve used your available AI credits. Add more to keep chatting.' );
}
