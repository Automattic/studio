import { describe, expect, it } from 'vitest';
import { createSessionStateStore } from '@/data/agent-runs/store';
import { addTextEdit, getSiteAnnotations } from './store';
import { trackTextEditRun } from './track-text-edit-run';

function setup() {
	const siteId = crypto.randomUUID();
	const id = crypto.randomUUID();
	addTextEdit( siteId, {
		id,
		target: { selector: 'h1', url: 'http://localhost/' },
		originalText: 'Old title',
		text: 'New title',
		pending: true,
	} );
	const store = createSessionStateStore();
	const pending = () =>
		getSiteAnnotations( siteId ).textEdits?.find( ( edit ) => edit.id === id )?.pending;
	return { siteId, id, store, pending };
}

describe( 'text annotation progress', () => {
	it( 'keeps the replacement pending until its agent turn finishes', () => {
		const { siteId, id, store, pending } = setup();
		store.dispatch( 'session', { type: 'send_pending', startedAt: 1 } );
		trackTextEditRun( siteId, [ id ], 'session', 'Replace title', store );
		store.dispatch( 'another-session', { type: 'turn_completed' } );
		expect( pending() ).toBe( true );
		store.dispatch( 'session', { type: 'send_start', runId: 'run', startedAt: 1 } );
		expect( pending() ).toBe( true );
		store.dispatch( 'session', { type: 'turn_completed' } );
		expect( pending() ).toBe( false );
		expect( getSiteAnnotations( siteId ).textEdits?.[ 0 ].text ).toBe( 'New title' );
	} );

	it( 'waits for a queued annotation rather than the preceding turn', async () => {
		const { siteId, id, store, pending } = setup();
		store.dispatch( 'session', { type: 'send_start', runId: 'earlier', startedAt: 1 } );
		store.dispatch( 'session', {
			type: 'queue_append',
			prompt: { id: 'queued', prompt: 'Replace title' },
		} );
		trackTextEditRun( siteId, [ id ], 'session', 'Replace title', store );
		store.dispatch( 'session', { type: 'turn_completed' } );
		store.dispatch( 'session', { type: 'run_ended' } );
		expect( pending() ).toBe( true );
		store.dispatch( 'session', { type: 'queue_shift' } );
		store.dispatch( 'session', { type: 'send_pending', startedAt: 2 } );
		await Promise.resolve();
		expect( pending() ).toBe( true );
		store.dispatch( 'session', { type: 'turn_completed' } );
		expect( pending() ).toBe( false );
	} );

	it( 'stops the pending treatment after a failed start or interruption', () => {
		const { siteId, id, store, pending } = setup();
		store.dispatch( 'session', { type: 'send_pending', startedAt: 1 } );
		trackTextEditRun( siteId, [ id ], 'session', 'Replace title', store );
		store.dispatch( 'session', { type: 'run_ended' } );
		expect( pending() ).toBe( false );
	} );
} );
