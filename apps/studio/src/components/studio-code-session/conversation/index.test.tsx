/**
 * @jest-environment node
 */
import { describe, expect, it } from 'vitest';
import { entriesToRenderItems } from './index';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

function customEntry( customType: string, data: unknown ): SessionEntry {
	return {
		type: 'custom',
		id: Math.random().toString( 36 ).slice( 2 ),
		parentId: null,
		timestamp: '2026-06-19T00:00:00.000Z',
		customType,
		data,
	} as unknown as SessionEntry;
}

function question( q: string, options: string[] ): SessionEntry {
	return customEntry( 'studio.agent_question', {
		question: q,
		options: options.map( ( label ) => ( { label, description: '' } ) ),
	} );
}

function answer( text: string ): SessionEntry {
	return customEntry( 'studio.user_prompt', { text, source: 'ask_user' } );
}

describe( 'entriesToRenderItems – persisted picked answers', () => {
	it( 'pairs a question with its persisted ask_user answer', () => {
		const items = entriesToRenderItems( [ question( 'Pick one', [ 'A', 'B' ] ), answer( 'B' ) ] );
		const q = items.find( ( i ) => i.kind === 'agent-question' );
		expect( q ).toMatchObject( { kind: 'agent-question', question: 'Pick one', answer: 'B' } );
	} );

	it( 'pairs a batch of questions with answers by order', () => {
		// The CLI persists all questions first, then all answers, in question order.
		const items = entriesToRenderItems( [
			question( 'Q1', [ 'A', 'B' ] ),
			question( 'Q2', [ 'C', 'D' ] ),
			answer( 'A' ),
			answer( 'D' ),
		] );
		const questions = items.filter( ( i ) => i.kind === 'agent-question' );
		expect( questions ).toMatchObject( [
			{ question: 'Q1', answer: 'A' },
			{ question: 'Q2', answer: 'D' },
		] );
	} );

	it( 'leaves answer undefined for an unanswered question', () => {
		const items = entriesToRenderItems( [ question( 'Q1', [ 'A', 'B' ] ) ] );
		const q = items.find( ( i ) => i.kind === 'agent-question' );
		expect( q ).toMatchObject( { question: 'Q1', answer: undefined } );
	} );

	it( 'does not render ask_user prompts as user text', () => {
		const items = entriesToRenderItems( [ question( 'Q1', [ 'A' ] ), answer( 'A' ) ] );
		expect( items.some( ( i ) => i.kind === 'user-text' ) ).toBe( false );
	} );
} );

function assistantThinkingEntry( thinking: string ): SessionEntry {
	return {
		type: 'message',
		id: 'assistant-thinking',
		parentId: null,
		timestamp: '2026-06-19T00:00:00.000Z',
		message: {
			role: 'assistant',
			content: [
				{ type: 'thinking', thinking },
				{ type: 'text', text: 'The final answer.' },
			],
		},
	} as unknown as SessionEntry;
}

describe( 'entriesToRenderItems – thinking blocks', () => {
	it( 'maps thinking blocks to render items before the answer text', () => {
		const items = entriesToRenderItems( [ assistantThinkingEntry( 'Weighing two options.' ) ] );
		expect( items.map( ( i ) => i.kind ) ).toEqual( [ 'thinking', 'assistant-text' ] );
		expect( items[ 0 ] ).toMatchObject( { kind: 'thinking', text: 'Weighing two options.' } );
	} );

	it( 'drops whitespace-only thinking blocks', () => {
		const items = entriesToRenderItems( [ assistantThinkingEntry( '   \n  ' ) ] );
		expect( items.map( ( i ) => i.kind ) ).toEqual( [ 'assistant-text' ] );
	} );

	it( 'derives the thinking duration from entry timestamps', () => {
		const prior = customEntry( 'studio.user_prompt', { text: 'Question', source: 'prompt' } );
		( prior as unknown as { timestamp: string } ).timestamp = '2026-06-18T23:59:57.000Z';
		const items = entriesToRenderItems( [ prior, assistantThinkingEntry( 'Reasoning.' ) ] );
		const thinking = items.find( ( i ) => i.kind === 'thinking' );
		expect( thinking ).toMatchObject( { kind: 'thinking', durationMs: 3000 } );
	} );
} );
