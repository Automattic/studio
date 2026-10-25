import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createElement, useState } from 'react';
import { vi } from 'vitest';
import { Conversation } from '@/features/chats/session-view/conversation';
import type { LoadedAiSession, SessionEntry } from '@/data/core';

interface RenderConversationOptions {
	isRunning?: boolean;
	startedAt?: number | null;
	pendingQuestions?: Set< string >;
	pendingAnswers?: Record< string, string >;
	freeFormQuestion?: string | null;
	onAnswerQuestion?: ( question: string, label: string ) => void;
	onChooseFreeForm?: ( question: string ) => void;
}

export function renderConversation(
	data: LoadedAiSession,
	options: RenderConversationOptions = {}
) {
	const queryClient = new QueryClient( {
		defaultOptions: { queries: { retry: false } },
	} );
	return render(
		createElement(
			QueryClientProvider,
			{ client: queryClient },
			createElement( Conversation, {
				data,
				isRunning: options.isRunning ?? false,
				startedAt: options.startedAt ?? null,
				pendingQuestions: options.pendingQuestions ?? new Set< string >(),
				pendingAnswers: options.pendingAnswers ?? {},
				freeFormQuestion: options.freeFormQuestion ?? null,
				onAnswerQuestion: options.onAnswerQuestion ?? vi.fn(),
				onChooseFreeForm: options.onChooseFreeForm ?? vi.fn(),
			} )
		)
	);
}

export function renderInteractiveConversation(
	data: LoadedAiSession,
	pendingQuestionTexts: string[],
	onAnswerQuestion: ( question: string, label: string ) => void
) {
	return render(
		createElement( InteractiveConversation, {
			data,
			pendingQuestionTexts,
			onAnswerQuestion,
		} )
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

	return createElement( Conversation, {
		data,
		isRunning: false,
		startedAt: null,
		pendingQuestions: new Set( pendingQuestionTexts ),
		pendingAnswers,
		freeFormQuestion: null,
		onAnswerQuestion: ( question, label ) => {
			onAnswerQuestion( question, label );
			setPendingAnswers( ( answers ) => ( { ...answers, [ question ]: label } ) );
		},
		onChooseFreeForm: () => {},
	} );
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
