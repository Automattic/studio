import { describe, expect, it } from 'vitest';
import { migrateLegacyEvents } from '../migration';

describe( 'migrateLegacyEvents', () => {
	it( 'normalizes legacy clear events by keeping only post-clear entries', () => {
		const entries = migrateLegacyEvents(
			[
				{
					type: 'session.started',
					timestamp: '2026-01-01T00:00:00.000Z',
					version: 1,
					sessionId: 'session-1',
				},
				{
					type: 'user.message',
					timestamp: '2026-01-01T00:00:01.000Z',
					text: 'before clear',
					source: 'prompt',
				},
				{
					type: 'session.cleared',
					timestamp: '2026-01-01T00:00:02.000Z',
				},
				{
					type: 'session.linked',
					timestamp: '2026-01-01T00:00:02.500Z',
					agentSessionId: 'legacy-sdk-session',
				},
				{
					type: 'user.message',
					timestamp: '2026-01-01T00:00:03.000Z',
					text: 'after clear',
					source: 'prompt',
				},
			],
			'/tmp/site'
		);

		const serialized = JSON.stringify( entries );
		expect( serialized ).not.toContain( 'studio.session_cleared' );
		expect( serialized ).not.toContain( 'studio.session_linked' );
		expect( serialized ).not.toContain( 'legacy-sdk-session' );
		expect( serialized ).not.toContain( 'before clear' );
		expect( serialized ).toContain( 'after clear' );
		expect( entries[ 0 ] ).toMatchObject( {
			type: 'session',
			id: 'session-1',
			cwd: '/tmp/site',
		} );
	} );

	it( 'normalizes SDK-era prefixed tool names during migration', () => {
		const entries = migrateLegacyEvents(
			[
				{
					type: 'session.started',
					timestamp: '2026-01-01T00:00:00.000Z',
					version: 1,
					sessionId: 'session-1',
				},
				{
					type: 'sdk.message',
					timestamp: '2026-01-01T00:00:01.000Z',
					message: {
						type: 'assistant',
						message: {
							model: 'claude-sonnet-4-6',
							content: [
								{
									type: 'tool_use',
									id: 'toolu_1',
									name: 'mcp__studio__site_create',
									input: { name: 'Test' },
								},
							],
						},
					},
				},
				{
					type: 'sdk.message',
					timestamp: '2026-01-01T00:00:02.000Z',
					message: {
						type: 'user',
						message: {
							content: [
								{
									type: 'tool_result',
									tool_use_id: 'toolu_1',
									content: 'ok',
								},
							],
						},
					},
				},
			],
			'/tmp/site'
		);

		const messages = entries
			.filter( ( entry ) => entry.type === 'message' )
			.map( ( entry ) => entry.message as Record< string, unknown > );
		const assistant = messages.find( ( message ) => message.role === 'assistant' ) as
			| { content?: Array< { name?: string } > }
			| undefined;
		const toolResult = messages.find( ( message ) => message.role === 'toolResult' ) as
			| { toolName?: string }
			| undefined;

		expect( assistant?.content?.[ 0 ]?.name ).toBe( 'site_create' );
		expect( toolResult?.toolName ).toBe( 'site_create' );
	} );
} );
