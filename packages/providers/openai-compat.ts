import type { Model } from '@earendil-works/pi-ai';

// Chat Completions as most upstreams take it. pi infers `compat` from the base
// URL, which for any other host reads as plain OpenAI, so spell out the shape
// or requests carry OpenAI-only fields other upstreams reject. With
// `supportsReasoningEffort` false no thinking switch is sent at all and each
// upstream uses its own default.
export const PORTABLE_COMPLETIONS_COMPAT: Model< 'openai-completions' >[ 'compat' ] = {
	supportsStore: false,
	supportsDeveloperRole: false,
	supportsReasoningEffort: false,
	supportsStrictMode: false,
	maxTokensField: 'max_tokens',
};
