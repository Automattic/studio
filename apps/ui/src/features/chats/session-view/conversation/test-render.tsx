import { render } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { vi } from 'vitest';
import { AppProviders } from '@/app/app-providers';
import { Conversation } from '@/features/chats/session-view/conversation';
import { createFakeConnector, type FakeConnector } from '@/test/fake-connector';
import { createTestQueryClient } from '@/test/render';
import type { LoadedAiSession, SessionEntry } from '@/data/core';

type RenderConversationOptions = Partial<
	Omit< ComponentProps< typeof Conversation >, 'data' >
> & { connector?: FakeConnector };

// Renders inside the app's providers without a router, so the transcript is
// in the document as soon as `render` returns, fake timers included.
export function renderConversation(
	data: LoadedAiSession,
	{ connector = createFakeConnector(), ...props }: RenderConversationOptions = {}
) {
	const queryClient = createTestQueryClient();
	const element = ( session: LoadedAiSession ) => (
		<AppProviders connector={ connector } queryClient={ queryClient }>
			<Conversation
				data={ session }
				isRunning={ false }
				startedAt={ null }
				pendingQuestions={ new Set() }
				pendingAnswers={ {} }
				freeFormQuestion={ null }
				onAnswerQuestion={ vi.fn() }
				onChooseFreeForm={ vi.fn() }
				{ ...props }
			/>
		</AppProviders>
	);
	const view = render( element( data ) );
	return { ...view, connector };
}

export function renderInteractiveConversation(
	data: LoadedAiSession,
	pendingQuestionTexts: string[],
	onAnswerQuestion: ( question: string, label: string ) => void
) {
	return render(
		<AppProviders connector={ createFakeConnector() } queryClient={ createTestQueryClient() }>
			<InteractiveConversation
				data={ data }
				pendingQuestionTexts={ pendingQuestionTexts }
				onAnswerQuestion={ onAnswerQuestion }
			/>
		</AppProviders>
	);
}

function InteractiveConversation( {
	data,
	pendingQuestionTexts,
	onAnswerQuestion,
}: {
	data: LoadedAiSession;
	pendingQuestionTexts: string[];
	onAnswerQuestion: ( question: string, label: string ) => void;
} ) {
	const [ pendingAnswers, setPendingAnswers ] = useState< Record< string, string > >( {} );

	return (
		<Conversation
			data={ data }
			isRunning={ false }
			startedAt={ null }
			pendingQuestions={ new Set( pendingQuestionTexts ) }
			pendingAnswers={ pendingAnswers }
			freeFormQuestion={ null }
			onAnswerQuestion={ ( question, label ) => {
				onAnswerQuestion( question, label );
				setPendingAnswers( ( answers ) => ( { ...answers, [ question ]: label } ) );
			} }
			onChooseFreeForm={ () => {} }
		/>
	);
}

export function loadedSession( entries: SessionEntry[] ): LoadedAiSession {
	return {
		summary: {
			id: 'session-1',
			filePath: '/tmp/session-1.json',
			createdAt: '2026-06-05T12:00:00.000Z',
			updatedAt: '2026-06-05T12:00:00.000Z',
			activeEnvironment: 'local',
			eventCount: entries.length,
		},
		entries,
	};
}
