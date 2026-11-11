import { __ } from '@wordpress/i18n';

export interface AiModel {
	id: string;
	apiModelId?: string;
	label: string;
	family: string;
	supportsImages?: boolean;
	requiresPaidAiCredits?: boolean;
	getLabel?: () => string;
	getDescription?: () => string;
}

export interface AiProviderDescriptor {
	id: string;
	label: string;
	cliLabel: string;
	modelLabel: string;
	usesStudioCredits: boolean;
	connection: { type: 'account' | 'api-key'; usesStudioAccount?: boolean };
	models: readonly AiModel[];
	defaultModel: string;
	paidDefaultModel?: string;
}

export const AI_PROVIDERS = [
	{
		id: 'wpcom',
		label: 'WordPress.com',
		cliLabel: 'WordPress.com',
		modelLabel: 'WordPress',
		usesStudioCredits: true,
		connection: { type: 'account', usesStudioAccount: true },
		defaultModel: 'fast',
		paidDefaultModel: 'balanced',
		models: [
			{
				id: 'fast',
				label: 'Fast',
				getLabel: () => __( 'Fast' ),
				getDescription: () => __( 'Quick fixes and questions' ),
				family: 'studio',
				supportsImages: false,
			},
			{
				id: 'balanced',
				apiModelId: 'balanced-2',
				label: 'Balanced',
				getLabel: () => __( 'Balanced' ),
				getDescription: () => __( 'Build features, style pages, and fix bugs' ),
				family: 'studio',
				requiresPaidAiCredits: true,
			},
			{
				id: 'strong',
				apiModelId: 'strong-2',
				label: 'Strong',
				getLabel: () => __( 'Strong' ),
				getDescription: () => __( 'Plan complex builds and solve harder problems' ),
				family: 'studio',
				requiresPaidAiCredits: true,
			},
		],
	},
	{
		id: 'anthropic-api-key',
		label: 'Anthropic API',
		cliLabel: 'Anthropic · API key',
		modelLabel: 'Claude',
		usesStudioCredits: false,
		connection: { type: 'api-key' },
		defaultModel: 'claude-sonnet-5',
		models: [
			{
				id: 'claude-sonnet-5',
				label: 'Sonnet 5',
				getDescription: () => __( 'Build features, style pages, and fix bugs' ),
				family: 'anthropic',
			},
			{
				id: 'claude-opus-5',
				label: 'Opus 5',
				getDescription: () => __( 'Plan complex builds and solve harder problems' ),
				family: 'anthropic',
			},
		],
	},
	{
		id: 'gemini-api-key',
		label: 'Google Gemini API',
		cliLabel: 'Google Gemini · API key',
		modelLabel: 'Gemini',
		usesStudioCredits: false,
		connection: { type: 'api-key' },
		defaultModel: 'gemini-3.8-flash',
		models: [
			{
				id: 'gemini-3.8-flash',
				label: 'Gemini 3.8 Flash',
				getDescription: () => __( 'Quick fixes and questions' ),
				family: 'google',
			},
			{
				id: 'gemini-4-argon',
				label: 'Gemini 4 Argon',
				getDescription: () => __( 'Build features, style pages, and fix bugs' ),
				family: 'google',
			},
			{
				id: 'gemini-4-carbon',
				label: 'Gemini 4 Carbon',
				getDescription: () => __( 'Plan complex builds and solve harder problems' ),
				family: 'google',
			},
		],
	},
] as const satisfies readonly AiProviderDescriptor[];
