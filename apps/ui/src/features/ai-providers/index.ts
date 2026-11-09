import { anthropicUiProvider } from './anthropic';
import { wpcomUiProvider } from './wpcom';
import type { ProviderConnectionProps } from './types';
import type { AiProviderId } from '@studio/agent/protocol/providers';
import type { ComponentType } from 'react';

const PROVIDER_UI = {
	wpcom: wpcomUiProvider,
	'anthropic-api-key': anthropicUiProvider,
} satisfies Record<
	AiProviderId,
	{ icon: typeof wpcomUiProvider.icon; Connection: ComponentType< ProviderConnectionProps > }
>;

export function getAiProviderUi( provider: AiProviderId ) {
	return PROVIDER_UI[ provider ];
}
