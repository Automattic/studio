import { __ } from '@wordpress/i18n';
import { wpcomConfigSchema, type WpcomConfig } from './config';
import { getAuthorizeUrl } from './oauth';
import {
	withWpcomDetails,
	wpcomPushWarning,
	wpcomSiteAddress,
	wpcomSiteDetails,
	wpcomSiteIssue,
	wpcomSiteLinks,
	type SyncSite,
} from './site';
import type { AiModel, ProviderDescriptor } from '../types';

// Capability tiers, not concrete models: the proxy's `studio-agent` lane
// resolves each alias to an upstream model server-side, so the mapping can
// change without a release.
export const WPCOM_AI_MODELS = [
	{ id: 'fast', label: () => __( 'Fast' ), supportsImages: false },
	{ id: 'balanced', label: () => __( 'Balanced' ), requiresPaidAiCredits: true },
	{ id: 'strong', label: () => __( 'Strong' ), requiresPaidAiCredits: true },
] as const satisfies readonly AiModel[];

export const wpcomDescriptor: ProviderDescriptor< WpcomConfig, SyncSite > = {
	id: 'wpcom',
	label: 'WordPress.com',
	configSchema: wpcomConfigSchema,
	// Connecting is signing in to Studio.
	connection: { kind: 'redirect', redirectUrl: getAuthorizeUrl },
	summarize: ( config ) => config.user?.email ?? '',
	ai: {
		models: WPCOM_AI_MODELS,
		defaultModel: 'fast',
		paidDefaultModel: 'balanced',
	},
	sites: {
		maxPushSize: 5 * 1024 * 1024 * 1024,
		pull: true,
		selective: true,
		newSite: 'checkout',
		intro: {
			title: () => __( 'Publish your WordPress' ),
			description: () =>
				__(
					'Publish to a new site and choose a domain, or use an existing site on WordPress.com or Pressable.'
				),
			learnMoreUrl: 'https://wordpress.studio/docs/sync/',
		},
		address: wpcomSiteAddress,
		details: wpcomSiteDetails,
		links: wpcomSiteLinks,
		issue: wpcomSiteIssue,
		pushWarning: wpcomPushWarning,
		// A site without a plan that supports publishing has no backups to browse.
		hasBackups: ( site ) => ! site.pushNeedsUpgrade,
		withDetails: withWpcomDetails,
	},
};
