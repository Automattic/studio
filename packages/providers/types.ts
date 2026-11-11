import type { AnthropicConfig } from './anthropic/config';
import type { AiModelId } from './models';
import type { WpcomConfig } from './wpcom/config';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { z } from 'zod';

export type ProviderId = 'wpcom' | 'anthropic';

// What Studio stores for each provider.
export interface ProviderConfigs {
	wpcom: WpcomConfig;
	anthropic: AnthropicConfig;
}

export interface AiModel< Id extends string = string > {
	// Stable, stored in sessions; the same id in two providers is the same model.
	id: Id;
	label: () => string;
	// Defaults to true. Text-only models must not advertise vision they lack:
	// screenshot tool results are images.
	supportsImages?: boolean;
	// UI gating only: pickers disable the model unless purchased AI credits
	// remain (Automatticians exempt). The provider enforces access.
	requiresPaidAiCredits?: boolean;
}

export interface ProviderDescriptor< Config = unknown > {
	id: ProviderId;
	// Brand name, not translated.
	label: string;
	// What Studio stores for this provider.
	configSchema: z.ZodType< Config >;
	ai?: {
		models: readonly AiModel< AiModelId >[];
		defaultModel: AiModelId;
		// The default when the account has paid AI credits left.
		paidDefaultModel?: AiModelId;
	};
}

// Everything the runtime needs to register one model with pi.
export interface AiConnection {
	piProvider: string;
	apiKey: string;
	headers?: Record< string, string >;
	model: Model< Api >;
	// The upstream alias sent on the wire when it differs from the model id.
	requestModelId?: string;
	// Replaces a stream error's message; `undefined` keeps it.
	rewriteError?: ( message: string ) => string | undefined;
}

export interface GenerateImageRequest {
	prompt: string;
	aspectRatio?: string;
}

export interface GenerateImageResult {
	ok: boolean;
	bytes?: Uint8Array;
	error?: string;
	// Rejected by a safety filter; rewriting the prompt may get it through.
	filtered?: boolean;
}

// Results keep the requests' order; a failure never aborts the rest.
export type GenerateImages< Config > = (
	config: Config | undefined,
	requests: GenerateImageRequest[],
	onResult?: ( index: number, result: GenerateImageResult ) => void
) => Promise< GenerateImageResult[] >;

export interface Provider< Config = unknown > {
	descriptor: ProviderDescriptor< Config >;
	// Validates the key, and returns the config to store.
	connectApiKey?( key: string ): Promise< Config >;
	ai?: {
		// Whether a selection that isn't ready falls back to another ready
		// provider instead of asking for credentials.
		fallbackWhenNotReady: boolean;
		connect(
			config: Config | undefined,
			model: AiModelId,
			options: { sessionId?: string }
		): Promise< AiConnection >;
		generateImages?: GenerateImages< Config >;
	};
}
