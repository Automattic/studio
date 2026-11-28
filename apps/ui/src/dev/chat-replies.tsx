import '@studio/ds/theme/tokens.css';
import '@studio/ds/theme/base.css';
import '@/index.css';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { createRoot } from 'react-dom/client';
import { App } from '@/app';
import { createInMemoryConnector, makeSession, makeSite } from '@/test/in-memory-connector';
import { assistantTextEntry, promptEntry, turnClosedEntry } from '@/test/session-entries';
import { sampleImage } from './chat-samples';
import type { SessionEntry } from '@/data/core';

const params = new URLSearchParams( location.search );
const scheme = params.get( 'scheme' ) === 'dark' ? 'dark' : 'light';
const site = makeSite( { id: 'reply-preview-site', name: 'Neighborhood bistro', running: true } );
const summary = makeSession( {
	id: 'reply-preview-chat',
	title: 'A warmer welcome',
	ownerSiteId: site.id,
	ownerSitePath: site.path,
} );
const original = assistantTextEntry(
	'Try **Good food. Familiar faces.** for the headline.\n\nSeasonal cooking, a table by the window, and a reason to stay a little longer.'
);
const entries: SessionEntry[] = [
	promptEntry( 'Keep the language casual.' ),
	original,
	turnClosedEntry( 'success' ),
	{
		...promptEntry( 'Which part?' ),
		data: {
			source: 'prompt',
			text: 'Which part?',
			reply: { sessionId: summary.id, entryId: original.id, excerpt: 'Good food. Familiar faces.' },
		},
	} as SessionEntry,
	assistantTextEntry( 'The headline. It sets a welcoming tone without being too formal.' ),
	turnClosedEntry( 'success' ),
	...( params.has( 'image' )
		? [
				{
					...promptEntry( '' ),
					data: {
						source: 'prompt',
						text: '',
						attachments: [
							{
								id: 'reference',
								name: 'Header.png',
								kind: 'image',
								previewDataUrl: `data:image/svg+xml,${ encodeURIComponent(
									sampleImage( 'desktop' )
								) }`,
							},
						],
					},
				} as SessionEntry,
		  ]
		: [] ),
];
const connector = createInMemoryConnector(
	{ sites: [ site ], sessions: [ { summary, entries } ], preferences: { colorScheme: scheme } },
	{
		capabilities: { messageReplies: ! params.has( 'legacy' ) },
		getOnboardingCompleted: async () => true,
		continueSession: async ( sessionId, prompt, options ) => {
			const session = connector.state.sessions.find( ( s ) => s.summary.id === sessionId )!;
			const runId = crypto.randomUUID();
			session.entries = [
				...session.entries,
				{
					...promptEntry( options?.displayMessage ?? prompt ),
					id: crypto.randomUUID(),
					timestamp: new Date().toISOString(),
					data: {
						text: options?.displayMessage ?? prompt,
						source: 'prompt',
						reply: options?.reply,
						inputId: options?.turnId,
					},
				} as SessionEntry,
				assistantTextEntry( 'I’ll use that part as the reference.' ),
				turnClosedEntry( 'success' ),
			];
			setTimeout( () => {
				const timestamp = new Date().toISOString();
				connector.emit( 'onAgentEvent', {
					sessionId,
					runId,
					event: { type: 'turn.completed', timestamp, sessionId, status: 'success' },
				} );
				connector.emit( 'onAgentEvent', {
					sessionId,
					runId,
					event: { type: 'run.exited', timestamp, status: 'success', code: 0 },
				} );
			}, 100 );
			return { runId };
		},
	}
);
createRoot( document.getElementById( 'root' )! ).render(
	<App
		connector={ connector }
		queryClient={ new QueryClient() }
		history={ createMemoryHistory( { initialEntries: [ `/sessions/${ summary.id }` ] } ) }
	/>
);
