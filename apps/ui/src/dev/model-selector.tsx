import '@/lib/theme/tokens.css';
import '@/lib/theme/base.css';
import '@/index.css';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app';
import {
	aiSettings,
	createInMemoryConnector,
	makeSession,
	makeSite,
} from '@/test/in-memory-connector';
import type { SessionEntry } from '@/data/core';
import type { ModelFavorite } from '@studio/common/lib/user-settings/model-favorites';

const params = new URLSearchParams( window.location.search );
const scheme = params.get( 'scheme' ) === 'dark' ? 'dark' : 'light';
const conversation = params.get( 'state' ) === 'conversation';
const sites = [ 'My WordPress site', 'Personal blog', 'Design portfolio' ].map( ( name, index ) =>
	makeSite( { id: `model-preview-${ index }`, name } )
);
const summary = makeSession( {
	id: 'model-preview-chat',
	title: 'Build my site',
	ownerSiteId: sites[ 0 ].id,
	ownerSitePath: sites[ 0 ].path,
} );
const entries: SessionEntry[] = [
	{
		type: 'custom',
		id: 'model-context',
		parentId: null,
		timestamp: new Date().toISOString(),
		customType: 'studio.session_context',
		data: { provider: 'anthropic-api-key', model: 'claude-sonnet-5-5', thinking: 'default' },
	},
	{
		type: 'custom',
		id: 'model-prompt',
		parentId: 'model-context',
		timestamp: new Date().toISOString(),
		customType: 'studio.user_prompt',
		data: { source: 'prompt', text: 'Help me build a personal site.' },
	},
];
const modelFavorites: ModelFavorite[] = [
	{ provider: 'anthropic-api-key', model: 'claude-sonnet-5-5', effort: 'default' },
	{ provider: 'anthropic-api-key', model: 'claude-sonnet-5-5', effort: 'high' },
	{ provider: 'wpcom', model: 'fast', effort: 'default' },
	{ provider: 'wpcom', model: 'strong', effort: 'default' },
];
const connector = createInMemoryConnector(
	{
		sites,
		preferences: {
			colorScheme: scheme,
			modelFavorites: params.get( 'favorites' ) === 'empty' ? [] : modelFavorites,
		},
		sessions: conversation ? [ { summary, entries } ] : [],
	},
	{
		getOnboardingCompleted: async () => true,
		getAiSettings: async () => aiSettings( 'anthropic', [ 'wpcom', 'anthropic' ] ),
		getStudioAssistantQuota: async () => ( {
			costCap: 1000,
			costUsage: 0,
			costResetDate: undefined,
			studioCodeAiHasAccess: undefined,
			studioCodeAiAccess: undefined,
			allowanceRemaining: 1000,
			purchasedRemaining: 500,
			purchasedAtTopUp: 500,
			emailVerified: true,
			hasPaymentMethod: true,
		} ),
	}
);

createRoot( document.getElementById( 'root' )! ).render(
	<StrictMode>
		<App
			connector={ connector }
			queryClient={ new QueryClient() }
			history={ createMemoryHistory( {
				initialEntries: [
					conversation ? `/sessions/${ summary.id }` : `/sites/${ sites[ 0 ].id }/new`,
				],
			} ) }
		/>
	</StrictMode>
);
