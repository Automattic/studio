import { NotConnectedError } from '../../errors';
import { PORTABLE_COMPLETIONS_COMPAT } from '../../openai-compat';
import { WPCOM_AI_MODELS } from '../descriptor';
import { getAiGatewayBaseUrl } from './gateway';
import { generateWpcomImages } from './images';
import type { AiConnection, AiModel, ProviderServices } from '../../types';
import type { WpcomConfig } from '../config';
import type { Api, Model } from '@earendil-works/pi-ai';

// The proxy's `studio-agent` lane accepts the tier aliases and resolves each
// to an upstream model.
const AI_FEATURE = 'studio-agent';

// The context window is a conservative floor across the upstreams a tier may
// resolve to, so compaction kicks in before any of them overflows.
const TIER_LIMITS = { contextWindow: 200_000, maxTokens: 32_000 };

type Tier = Pick< Model< Api >, 'api' | 'reasoning' | 'compat' > & {
	// The upstream alias sent on the wire.
	requestModelId?: string;
};

const TIERS: Record< string, Tier > = {
	// Chat Completions, to whichever upstream the tier resolves to.
	fast: { api: 'openai-completions', reasoning: true, compat: PORTABLE_COMPLETIONS_COMPAT },
	// Responses: its upstream is a reasoning model that rejects
	// tools-plus-reasoning on Chat Completions.
	balanced: { api: 'openai-responses', reasoning: true, requestModelId: 'balanced-2' },
	// Anthropic Messages, which sits beside `/v1` rather than under it and
	// authenticates with a bearer token.
	strong: { api: 'anthropic-messages', reasoning: false, requestModelId: 'strong-2' },
};

// The proxy reports the account's monthly cost cap as a 429 carrying
// `cost_cap_exceeded`. pi treats a bare 429 as a transient throttle and
// retries; "Monthly usage limit reached" is the phrase it classifies as a
// non-retryable provider limit, and the apps key their cap UI on it. The
// code, not the status, is the gate: hosted upstreams return their own 429s
// for rate limits, and those should keep retrying. The out-of-credits 402
// (`studio_out_of_credits`) passes through: pi doesn't retry it.
function rewriteUsageCapError( message: string ): string | undefined {
	return /\bcost_cap_exceeded\b/i.test( message )
		? `Monthly usage limit reached: ${ message }`
		: undefined;
}

export const wpcomAi: NonNullable< ProviderServices< WpcomConfig >[ 'ai' ] > = {
	async model( config, modelId, { sessionId } ): Promise< AiConnection > {
		if ( ! config ) {
			throw new NotConnectedError( 'Log in to WordPress.com to use its models.' );
		}
		const model: AiModel | undefined = WPCOM_AI_MODELS.find( ( { id } ) => id === modelId );
		const tier = TIERS[ modelId ];
		if ( ! model || ! tier ) {
			throw new Error( `WordPress.com does not serve ${ modelId }` );
		}
		const { requestModelId, ...modelFields } = tier;
		const headers: Record< string, string > = {
			'X-WPCOM-AI-Feature': AI_FEATURE,
			...( sessionId ? { 'X-WPCOM-Session-ID': sessionId } : {} ),
		};
		const gateway = getAiGatewayBaseUrl();
		const anthropicMessages = tier.api === 'anthropic-messages';
		return {
			piProvider: 'studio-wpcom',
			apiKey: config.token,
			headers,
			model: {
				...modelFields,
				...TIER_LIMITS,
				id: modelId,
				name: modelId,
				provider: 'studio-wpcom',
				baseUrl: anthropicMessages ? gateway : `${ gateway }/v1`,
				input: model.supportsImages === false ? [ 'text' ] : [ 'text', 'image' ],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				headers: anthropicMessages
					? { ...headers, Authorization: `Bearer ${ config.token }` }
					: headers,
			},
			requestModelId,
			rewriteError: rewriteUsageCapError,
		};
	},
	generateImages: generateWpcomImages,
};
