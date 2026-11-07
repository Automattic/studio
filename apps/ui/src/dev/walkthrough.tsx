import '@/lib/theme/tokens.css';
import '@/lib/theme/base.css';
import '@/index.css';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app';
import { createInMemoryConnector, makeSite, TEST_USER } from '@/test/in-memory-connector';
import type { OnboardingHintsState } from '@/data/core';

const params = new URLSearchParams( window.location.search );
const siteOptions = params.get( 'stage' ) === 'options';
const workspace = params.get( 'stage' ) === 'workspace' || siteOptions;
const signedIn = params.get( 'account' ) === 'connected';
const anthropic = params.get( 'provider' ) === 'anthropic';
const emptyCredits = params.get( 'credits' ) === 'empty';
const gate = params.get( 'gate' );
const scheme = params.get( 'scheme' ) === 'dark' ? 'dark' : 'light';
let hints: OnboardingHintsState = {
	walkthroughStep: siteOptions ? 'intro' : workspace ? 'composer' : 'create',
};
const connector = createInMemoryConnector(
	{
		sites: workspace ? [ makeSite( { running: params.get( 'site' ) === 'running' } ) ] : [],
		user: signedIn ? TEST_USER : null,
		preferences: { colorScheme: scheme },
	},
	{
		getOnboardingCompleted: async () => true,
		getAiSettings: async () => {
			if ( gate === 'provider-error' ) throw new Error( 'Provider unavailable' );
			return {
				provider: anthropic ? 'anthropic-api-key' : 'wpcom',
				hasAnthropicApiKey: anthropic,
				anthropicApiKeyPreview: anthropic ? 'test' : null,
			};
		},
		getStudioAssistantQuota: async () => {
			if ( gate === 'offline' || gate === 'quota-error' ) {
				throw new Error( gate === 'offline' ? 'offline' : 'Quota unavailable' );
			}
			return {
				costResetDate: undefined,
				studioCodeAiHasAccess:
					gate === 'access' || gate === 'access-returning' || gate === 'blocked'
						? false
						: undefined,
				studioCodeAiAccess: gate === 'blocked' ? 'blocked' : undefined,
				purchasedAtTopUp: undefined,
				costUsage: gate === 'access-returning' ? 1 : 0,
				costCap: 100,
				emailVerified: true,
				hasPaymentMethod: gate !== 'payment',
				allowanceRemaining: emptyCredits ? 0 : 100,
				purchasedRemaining: 0,
			};
		},
		getOnboardingHints: async () => hints,
		setOnboardingHints: async ( patch ) => {
			hints = { ...hints, ...patch };
		},
	}
);
connector.capabilities.annotatePreview = params.get( 'host' ) !== 'browser';

createRoot( document.getElementById( 'root' )! ).render(
	<StrictMode>
		<App
			connector={ connector }
			queryClient={ new QueryClient( { defaultOptions: { queries: { retry: false } } } ) }
			history={ createMemoryHistory( {
				initialEntries: [ workspace ? '/' : '/sites?addSite=create' ],
			} ) }
		/>
	</StrictMode>
);
