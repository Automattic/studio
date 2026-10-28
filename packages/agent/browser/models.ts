import { streamSimple as streamAnthropicMessages } from '@earendil-works/pi-ai/api/anthropic-messages';
import { streamSimple as streamOpenAiCompletions } from '@earendil-works/pi-ai/api/openai-completions';
import { streamSimple as streamOpenAiResponses } from '@earendil-works/pi-ai/api/openai-responses';
import {
	aiModelSupportsImages,
	getAiModel,
	getAiModelFamily,
	type AiModelId,
} from '@studio/agent/protocol/models';
import { getWpcomAiGatewayBaseUrl } from '@studio/agent/shared/ai-gateway';
import { buildStudioModel } from '@studio/agent/shared/models';
import { withLeakedToolCallMarkupRemoved } from '@studio/agent/shared/runtime-guards/leaked-tool-call-markup';
import { stripStaleImagesFromContext } from '@studio/agent/shared/runtime-guards/strip-stale-images';
import { withUsageCapErrorRewrite } from '@studio/agent/shared/runtime-guards/usage-cap';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';

const WPCOM_AI_FEATURE = 'studio-agent';

export interface ModelCredentials {
	wpcomToken?: string;
	anthropicApiKey?: string;
	sessionId: string;
}

// The same model shapes as the Node runtime's, for requests made from a browser.
export function buildModel( modelId: AiModelId, credentials: ModelCredentials ): Model< Api > {
	const family = getAiModelFamily( modelId );
	return family === 'anthropic'
		? buildStudioModel( modelId, family, {
				apiKey: credentials.anthropicApiKey ?? '',
				baseUrl: 'https://api.anthropic.com',
		  } )
		: buildStudioModel( modelId, family, {
				apiKey: credentials.wpcomToken ?? '',
				baseUrl: `${ getWpcomAiGatewayBaseUrl().replace( /\/+$/, '' ) }/v1`,
				headers: {
					'X-WPCOM-AI-Feature': WPCOM_AI_FEATURE,
					'X-WPCOM-Session-ID': credentials.sessionId,
				},
		  } );
}

// The SDKs add `x-stainless-*` telemetry headers that the WordPress.com
// proxy's CORS policy rejects, so they are dropped on requests to it.
const proxyFetch: typeof fetch = ( input, init ) => {
	const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
	if ( ! url.startsWith( getWpcomAiGatewayBaseUrl() ) ) {
		return fetch( input, init );
	}
	const headers = new Headers( init?.headers ?? ( input instanceof Request ? input.headers : {} ) );
	for ( const name of [ ...headers.keys() ] ) {
		if ( name.startsWith( 'x-stainless' ) ) {
			headers.delete( name );
		}
	}
	return fetch( input, { ...init, headers } );
};

export function createStreamFn( modelId: AiModelId, credentials: ModelCredentials ): StreamFn {
	const apiModelId = getAiModel( modelId ).apiModelId;
	return ( model, context, options ) => {
		const apiKey =
			getAiModelFamily( modelId ) === 'anthropic'
				? credentials.anthropicApiKey
				: credentials.wpcomToken;
		const streamOptions = {
			...options,
			apiKey,
			fetch: proxyFetch,
			...( apiModelId
				? {
						onPayload: async ( params: unknown, payloadModel: Model< Api > ) => {
							const next = ( await options?.onPayload?.( params, payloadModel ) ) ?? params;
							return { ...( next as Record< string, unknown > ), model: apiModelId };
						},
				  }
				: {} ),
		};
		const stream =
			model.api === 'anthropic-messages'
				? streamAnthropicMessages
				: model.api === 'openai-responses'
				? streamOpenAiResponses
				: streamOpenAiCompletions;
		// The same guards as the Node runtime: a bounded image history, tool calls
		// leaked as text dropped, and the usage cap made non-retryable.
		return withUsageCapErrorRewrite(
			withLeakedToolCallMarkupRemoved(
				( stream as typeof streamOpenAiCompletions )(
					model as Model< 'openai-completions' >,
					stripStaleImagesFromContext( context ),
					streamOptions
				)
			)
		);
	};
}
