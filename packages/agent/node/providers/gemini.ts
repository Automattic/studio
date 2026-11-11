import { GOOGLE_MODELS } from '@earendil-works/pi-ai/providers/google.models';
import { validateGeminiApiKey } from './gemini-key';
import type { AiProvider } from './types';
import type { Model } from '@earendil-works/pi-ai';

export const geminiProvider = {
	auth: {
		type: 'api-key',
		validate: validateGeminiApiKey,
	},
	buildModel( modelId, creds, { supportsImages } ) {
		const googleCatalog = GOOGLE_MODELS as Partial<
			Record< string, Model< 'google-generative-ai' > >
		>;
		const directCatalogModel = googleCatalog[ modelId ];
		// Models released after the pinned pi-ai catalog snapshot (e.g. gemini-4-carbon)
		// share Gemini 4's discrete thinkingLevelMap and multimodal input limits.
		const catalogModel =
			directCatalogModel ??
			( /^gemini-(?:[4-9]|[1-9]\d)/.test( modelId )
				? googleCatalog[ 'gemini-4-argon' ]
				: undefined );
		return {
			id: modelId,
			name: directCatalogModel?.name ?? modelId,
			baseUrl: creds.baseURL.replace( /\/+$/, '' ),
			input: supportsImages ? [ 'text', 'image' ] : [ 'text' ],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			...( creds.extraHeaders ? { headers: creds.extraHeaders } : {} ),
			api: 'google-generative-ai',
			provider: 'google',
			reasoning: true,
			contextWindow: 200_000,
			maxTokens: directCatalogModel?.maxTokens ?? 65_536,
			...( catalogModel?.thinkingLevelMap
				? { thinkingLevelMap: catalogModel.thinkingLevelMap }
				: {} ),
			...( catalogModel?.compat ? { compat: catalogModel.compat } : {} ),
			...( catalogModel?.inputLimits ? { inputLimits: catalogModel.inputLimits } : {} ),
		};
	},
	async configureRuntime( runtime, _model, creds ) {
		await runtime.setRuntimeApiKey( 'google', creds.apiKey );
	},
} satisfies AiProvider;
