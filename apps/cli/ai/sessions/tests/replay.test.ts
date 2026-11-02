import { describe, expect, it, vi } from 'vitest';
import { replaySessionHistory } from '../replay';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { AiChatUI } from 'cli/ai/ui';

function createUiSpy() {
	return {
		prepareForReplay: vi.fn(),
		setReplayTimestamp: vi.fn(),
		setActiveSite: vi.fn(),
		beginAgentTurn: vi.fn(),
		addUserMessage: vi.fn(),
		endAgentTurn: vi.fn(),
		setLoaderMessage: vi.fn(),
		showAgentQuestion: vi.fn(),
		renderToolResults: vi.fn(),
		handleEvent: vi.fn(),
		finishReplay: vi.fn(),
	};
}

function toolProgress( message: string, timestamp: string ): SessionEntry {
	return {
		type: 'custom',
		customType: 'studio.tool_progress',
		timestamp,
		data: { message },
	} as SessionEntry;
}

describe( 'replaySessionHistory', () => {
	it( 'replays the conversation while ignoring interleaved progress', () => {
		const ui = createUiSpy();
		const entries: SessionEntry[] = [
			{
				type: 'custom',
				customType: 'studio.user_prompt',
				timestamp: '2026-06-01T00:00:00.000Z',
				data: { source: 'prompt', text: 'Create a landing page' },
			} as SessionEntry,
			toolProgress( 'Reading files…', '2026-06-01T00:00:01.000Z' ),
			toolProgress( 'Running WP-CLI…', '2026-06-01T00:00:02.000Z' ),
			{
				type: 'message',
				timestamp: '2026-06-01T00:00:03.000Z',
				message: {
					role: 'assistant',
					content: [ { type: 'text', text: 'Done.' } ],
				},
			} as SessionEntry,
			{
				type: 'custom',
				customType: 'studio.turn_closed',
				timestamp: '2026-06-01T00:00:04.000Z',
				data: { status: 'success' },
			} as SessionEntry,
		];

		replaySessionHistory( ui as unknown as AiChatUI, entries );

		expect( ui.setLoaderMessage ).not.toHaveBeenCalled();
		expect( ui.addUserMessage ).toHaveBeenCalledWith( 'Create a landing page' );
		expect( ui.beginAgentTurn ).toHaveBeenCalledTimes( 1 );
		expect( ui.handleEvent ).toHaveBeenCalledTimes( 1 );
		expect( ui.endAgentTurn ).toHaveBeenCalledTimes( 1 );
		expect( ui.finishReplay ).toHaveBeenCalledTimes( 1 );
	} );

	it.each( [
		{
			name: 'a WordPress.com site',
			data: {
				siteName: 'Live',
				sitePath: '',
				remote: true,
				url: 'https://x.wordpress.com',
				wpcomSiteId: 123,
			},
			remote: { host: 'wpcom', id: 123 },
		},
		{
			name: 'a local site',
			data: { siteName: 'Shop', sitePath: '/sites/shop', siteId: 'a1', remote: false },
			remote: undefined,
		},
	] )( 'restores $name a session selected', ( { data, remote } ) => {
		const ui = createUiSpy();
		replaySessionHistory( ui as unknown as AiChatUI, [
			{
				type: 'custom',
				customType: 'studio.site_selected',
				timestamp: '2026-06-01T00:00:00.000Z',
				data,
			} as SessionEntry,
		] );

		expect( ui.setActiveSite ).toHaveBeenCalledWith(
			expect.objectContaining( { name: data.siteName, path: data.sitePath, remote } ),
			{ announce: true, emitEvent: false }
		);
	} );
} );
