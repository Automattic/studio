import { anthropicSubscriptionUiProvider, anthropicUiProvider } from './anthropic';
import { chatGptUiProvider } from './chatgpt';
import { wpcomUiProvider } from './wpcom';
import type { ProviderConnectionProps } from './types';
import type { AiProviderId } from '@studio/agent/protocol/providers';
import type { ComponentProps, ComponentType } from 'react';

const PROVIDER_UI = {
	wpcom: wpcomUiProvider,
	'anthropic-api-key': anthropicUiProvider,
	chatgpt: chatGptUiProvider,
	'anthropic-subscription': anthropicSubscriptionUiProvider,
} satisfies Record<
	AiProviderId,
	{
		icon: ComponentType< ComponentProps< 'svg' > >;
		Connection: ComponentType< ProviderConnectionProps >;
	}
>;

export function getAiProviderUi( provider: AiProviderId ) {
	return PROVIDER_UI[ provider ];
}
