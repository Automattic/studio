import type { Api, Model } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';

export type RuntimeModel = Model< Api >;

export interface ProviderCredentials {
	apiKey: string;
	baseURL: string;
	extraHeaders?: Record< string, string >;
}

export type ApiKeyValidation =
	| { status: 'valid' | 'unverifiable' }
	| { status: 'invalid'; message: string };

export interface AiProvider {
	auth:
		| {
				type: 'api-key';
				validate: ( key: string ) => Promise< ApiKeyValidation >;
		  }
		| { type: 'account' };
	buildModel(
		modelId: string,
		credentials: ProviderCredentials,
		options: { supportsImages: boolean }
	): RuntimeModel;
	configureRuntime(
		runtime: ModelRuntime,
		model: RuntimeModel,
		credentials: ProviderCredentials
	): void | Promise< void >;
}

export class InvalidAiProviderCredentialsError extends Error {
	constructor( message: string ) {
		super( message );
		this.name = 'InvalidAiProviderCredentialsError';
	}
}
