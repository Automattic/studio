import '@/lib/theme/tokens.css';
import '@/lib/theme/base.css';
import '@/index.css';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app';
import { createInMemoryConnector, makeSession, makeSite } from '@/test/in-memory-connector';
import { chatSamples } from './chat-samples';

const params = new URLSearchParams( window.location.search );
const scheme = params.get( 'scheme' ) === 'light' ? 'light' : 'dark';
const loading = params.get( 'state' ) !== 'loaded';
const count = Math.min( 50, Math.max( 4, Number( params.get( 'rows' ) ) || 4 ) );
const sites = Array.from(
	{ length: count },
	( _, index ) =>
		[ 'My WordPress site', 'Personal blog', 'Design portfolio', 'Weekend project' ][ index ] ??
		`Sample site ${ index + 1 }`
).map( ( name, index ) => makeSite( { id: `sidebar-preview-${ index }`, name } ) );
const chat = params.get( 'chat' ) === 'long';
const session = makeSession( {
	id: 'sidebar-preview-chat',
	title: 'A longer conversation',
	ownerSiteId: sites[ 0 ].id,
	ownerSitePath: sites[ 0 ].path,
} );
const connector = createInMemoryConnector(
	{
		sites,
		preferences: { colorScheme: scheme },
		sessions: chat ? [ { summary: session, entries: chatSamples[ 0 ].entries } ] : [],
	},
	{
		getOnboardingCompleted: async () => true,
		getSites: async () => ( loading ? new Promise( () => {} ) : sites ),
	}
);

createRoot( document.getElementById( 'root' )! ).render(
	<StrictMode>
		<App
			connector={ connector }
			queryClient={ new QueryClient() }
			history={ createMemoryHistory( {
				initialEntries: chat ? [ `/sessions/${ session.id }` ] : [ '/' ],
			} ) }
		/>
		<nav
			aria-label="Sidebar preview"
			style={ {
				position: 'fixed',
				top: 64,
				right: 24,
				zIndex: 100,
				display: 'flex',
				gap: 16,
				fontSize: 13,
				padding: 12,
				background: 'var(--chrome)',
				border: '1px solid var(--border)',
				borderRadius: 'var(--radius-lg)',
			} }
		>
			<a href={ `?scheme=${ scheme }&state=${ loading ? 'loaded' : 'loading' }` }>
				{ loading ? 'Show loaded sidebar' : 'Show loading sidebar' }
			</a>
			<a
				href={ `?scheme=${ scheme === 'dark' ? 'light' : 'dark' }&state=${
					loading ? 'loading' : 'loaded'
				}` }
			>
				{ scheme === 'dark' ? 'Light mode' : 'Dark mode' }
			</a>
		</nav>
	</StrictMode>
);
