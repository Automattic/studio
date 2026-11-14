import { __ } from '@wordpress/i18n';
import { wpcomConfigSchema, type WpcomConfig } from './config';
import {
	describeWpcomSite,
	withWpcomDetails,
	wpcomDashboardUrl,
	wpcomPushWarning,
	wpcomSiteIssue,
	type SyncSite,
} from './sites/site';
import type { AiModel, Provider } from '../types';

// Capability tiers, not concrete models: the proxy's `studio-agent` lane
// resolves each alias to an upstream model server-side, so the mapping can
// change without a release.
export const WPCOM_AI_MODELS = [
	{ id: 'fast', label: () => __( 'Fast' ), supportsImages: false },
	{ id: 'balanced', label: () => __( 'Balanced' ), requiresPaidAiCredits: true },
	{ id: 'strong', label: () => __( 'Strong' ), requiresPaidAiCredits: true },
] as const satisfies readonly AiModel[];

// Studio's OAuth app on WordPress.com.
const CLIENT_ID = '95109';

export interface SignInUrlOptions {
	// Where WordPress.com sends the user back, with the token in the URL's fragment.
	redirectUri: string;
	locale: string;
	// Echoed back with the token, to tell the redirect is the one this started.
	state?: string;
	// Create an account before approving access.
	signup?: boolean;
}

// Signing in to Studio: the implicit grant, which sends the token back in the
// redirect's fragment, with `expires_in` and the `state` it was given.
export function getSignInUrl( { redirectUri, locale, state, signup }: SignInUrlOptions ): string {
	const url = new URL( 'https://public-api.wordpress.com/oauth2/authorize' );
	url.searchParams.set( 'response_type', 'token' );
	url.searchParams.set( 'client_id', CLIENT_ID );
	url.searchParams.set( 'redirect_uri', redirectUri );
	url.searchParams.set( 'scope', 'global' );
	url.searchParams.set( 'locale', locale );
	if ( state ) {
		url.searchParams.set( 'state', state );
	}
	if ( ! signup ) {
		return url.toString();
	}
	const signupUrl = new URL( 'https://wordpress.com/start/wpcc/oauth2-user' );
	signupUrl.searchParams.set( 'oauth2_client_id', CLIENT_ID );
	signupUrl.searchParams.set( 'oauth2_redirect', url.toString() );
	signupUrl.searchParams.set( 'locale', locale );
	return signupUrl.toString();
}

const mark =
	'<path d="M 22 12 C 22 6.49 17.51 2 12 2 C 6.48 2 2 6.49 2 12 C 2 17.52 6.48 22 12 22 C 17.51 22 22 17.52 22 12 M 9.78 17.37 L 6.37 8.22 C 6.92 8.2 7.54 8.14 7.54 8.14 C 8.04 8.08 7.98 7.01 7.48 7.03 C 7.48 7.03 6.03 7.14 5.11 7.14 C 4.93 7.14 4.74 7.14 4.53 7.13 C 6.12 4.69 8.87 3.11 12 3.11 C 14.33 3.11 16.45 3.98 18.05 5.45 C 17.37 5.34 16.4 5.84 16.4 7.03 C 16.4 7.77 16.85 8.39 17.3 9.13 C 17.65 9.74 17.85 10.49 17.85 11.59 C 17.85 13.08 16.45 16.59 16.45 16.59 L 13.42 8.22 C 13.96 8.2 14.24 8.05 14.24 8.05 C 14.74 8 14.68 6.8 14.18 6.83 C 14.18 6.83 12.74 6.95 11.8 6.95 C 10.93 6.95 9.47 6.83 9.47 6.83 C 8.97 6.8 8.91 8.03 9.41 8.05 L 10.33 8.13 L 11.59 11.54 L 9.78 17.37 M 19.41 12 C 19.65 11.36 20.15 10.13 19.84 7.75 C 20.54 9.04 20.89 10.46 20.89 12 C 20.89 15.29 19.16 18.24 16.49 19.78 C 17.46 17.19 18.43 14.58 19.41 12 M 8.1 20.09 C 5.12 18.65 3.11 15.53 3.11 12 C 3.11 10.7 3.34 9.52 3.83 8.41 C 5.25 12.3 6.67 16.2 8.1 20.09 M 12.13 13.46 L 14.71 20.44 C 13.85 20.73 12.95 20.89 12 20.89 C 11.21 20.89 10.43 20.78 9.71 20.56 C 10.52 18.18 11.33 15.82 12.13 13.46 L 12.13 13.46"/>';

export const wpcomProvider: Provider< WpcomConfig, SyncSite > = {
	id: 'wpcom',
	label: 'WordPress.com',
	description: () =>
		__(
			'Get started with a one-time free allowance, then buy more as you go. No API key required.'
		),
	icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">${ mark }</svg>`,
	logo: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 28 28"><rect x="-2" y="-2" width="28" height="28" fill="#3858E9"/><g fill="#FFF">${ mark }</g></svg>`,
	account: {
		configSchema: wpcomConfigSchema,
		// Connecting is signing in to Studio.
		methods: [ { id: 'sign-in', label: () => __( 'Log in' ), kind: 'redirect' } ],
		describe: ( config ) => ( { method: 'sign-in', summary: config.user?.email } ),
		expiresAt: ( config ) => config.expiresAt,
	},
	ai: {
		models: WPCOM_AI_MODELS,
		defaultModel: 'fast',
		paidDefaultModel: 'balanced',
	},
	sites: {
		publishing: {
			description: () => __( 'The full WordPress, with a domain' ),
			firstPublishDescription: ( site ) =>
				site.isPressable ? undefined : __( 'Publish your WordPress when you’re ready.' ),
		},
		visibility: ( site ) => ! site.isPressable,
		visibilityOptions: ( current ) => [
			{
				value: 'coming-soon',
				label: __( 'Only you' ),
				description: __( 'Visitors see a coming soon page' ),
			},
			{ value: 'public', label: __( 'Everyone' ), description: __( 'Your WordPress is public' ) },
			...( current === 'private'
				? [
						{
							value: 'private' as const,
							label: __( 'Invited people' ),
							description: __( 'Only you and people you invite can view.' ),
							disabled: true,
						},
				  ]
				: [] ),
		],
		visibilitySettingsLink: ( site ) => ( {
			title: __( 'Manage on WordPress.com' ),
			url: `https://wordpress.com/settings/general/${ site.id }`,
		} ),
		initialVisibility: ( site ) =>
			site.isPrivate
				? 'private'
				: site.isComingSoon || site.launchStatus === 'unlaunched'
				? 'coming-soon'
				: site.launchStatus === 'launched'
				? 'public'
				: undefined,
		isLaunched: ( site ) => site.isPressable || site.launchStatus === 'launched',
		previews: {
			matchesSite: ( site, id ) => site.id === id,
			isUpgraded: ( site ) => site.launchStatus === 'launched' || site.pushNeedsUpgrade === false,
		},
		maxPushSize: 5 * 1024 * 1024 * 1024,
		pull: true,
		selective: true,
		content: 'archive',
		newSite: 'checkout',
		intro: {
			title: () => __( 'Publish your WordPress' ),
			description: () =>
				__(
					'Publish to a new site and choose a domain, or use an existing site on WordPress.com or Pressable.'
				),
			learnMoreUrl: 'https://wordpress.studio/docs/sync/',
		},
		describe: describeWpcomSite,
		dashboardUrl: wpcomDashboardUrl,
		adminUrl: ( site ) => new URL( '/wp-admin/', site.url ).href,
		issue: wpcomSiteIssue,
		pushWarning: wpcomPushWarning,
		// A site without a plan that supports publishing has no backups to browse.
		hasBackups: ( site ) => ! site.pushNeedsUpgrade,
		withDetails: withWpcomDetails,
	},
};
