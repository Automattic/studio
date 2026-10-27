import { describe, expect, it } from 'vitest';
import { createSessionStateStore, hasUnansweredQuestion } from './store';

describe( 'createSessionStateStore', () => {
	it( "keeps a session's slice when another session changes", () => {
		const store = createSessionStateStore();
		store.dispatch( 'a', { type: 'send_start', runId: 'run-a', startedAt: 1 } );
		const a = store.getState().a;

		store.dispatch( 'b', { type: 'send_pending', startedAt: 2 } );

		expect( store.getState().a ).toBe( a );
	} );

	it( 'keeps queued prompts across a run ending', () => {
		const store = createSessionStateStore();
		store.dispatch( 'a', { type: 'send_start', runId: 'run-a', startedAt: 1 } );
		store.dispatch( 'a', { type: 'queue_append', prompt: { id: 'q', prompt: 'Next' } } );
		store.dispatch( 'a', { type: 'run_ended' } );

		expect( store.getState().a ).toMatchObject( {
			phase: 'idle',
			runId: null,
			queuedPrompts: [ { id: 'q', prompt: 'Next' } ],
		} );
	} );
} );

describe( 'hasUnansweredQuestion', () => {
	it( 'is true until every pending question has an answer', () => {
		const store = createSessionStateStore();
		store.dispatch( 'a', {
			type: 'questions_added',
			questions: [
				{ question: 'Q1', options: [] },
				{ question: 'Q2', options: [] },
			],
		} );
		store.dispatch( 'a', { type: 'question_answered', question: 'Q1', answer: 'Yes' } );
		expect( hasUnansweredQuestion( store.getState().a ) ).toBe( true );

		store.dispatch( 'a', { type: 'question_answered', question: 'Q2', answer: 'No' } );
		expect( hasUnansweredQuestion( store.getState().a ) ).toBe( false );
	} );
} );
