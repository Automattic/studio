import { STUDIO_CHAT_ARTIFACT_VERSION } from '@studio/common/ai/chat-artifacts';
import { describe, expect, it, vi } from 'vitest';
import { entriesToRenderItems } from './index';
import type { SessionEntry } from '@mariozechner/pi-coding-agent';

vi.mock( '@/components/markdown', () => ( {
	Markdown: () => null,
} ) );

vi.mock( '@/ui-desks/components', () => ( {
	Button: () => null,
} ) );

vi.mock( '@/ui-desks/desk/provider', () => ( {
	useDesk: () => ( {
		addWidget: vi.fn(),
		addWidgetAtScreenPoint: vi.fn(),
		canAddWidgets: true,
	} ),
} ) );

vi.mock( '@/ui-desks/widget-actions/create-widget', () => ( {
	createDeskWidget: () => null,
} ) );

vi.mock( '@wordpress/icons', () => ( {
	plus: {},
} ) );

vi.mock( '@wordpress/ui', () => ( {
	Icon: () => null,
} ) );

vi.mock( '../thinking-indicator', () => ( {
	ThinkingIndicator: () => null,
} ) );

vi.mock( '../widget-context', () => ( {
	summarizeWidgetList: () => '',
	WidgetContextThumbnailList: () => null,
} ) );

describe( 'desks conversation render items', () => {
	it( 'hides studio_present tool rows while keeping the artifact', () => {
		const items = entriesToRenderItems( [
			assistantToolCallEntry( 'studio_present' ),
			toolResultEntry( 'Presented 5 Studio widgets.' ),
			chatArtifactEntry(),
		] );

		expect( items.some( ( item ) => item.kind === 'tool-use' ) ).toBe( false );
		expect( items.some( ( item ) => item.kind === 'chat-artifact' ) ).toBe( true );
	} );

	it( 'keeps regular tool rows visible', () => {
		const items = entriesToRenderItems( [
			assistantToolCallEntry( 'wp_cli' ),
			toolResultEntry( 'Success' ),
		] );

		expect( items ).toEqual(
			expect.arrayContaining( [
				expect.objectContaining( {
					kind: 'tool-use',
					name: 'wp_cli',
					result: expect.objectContaining( { text: 'Success' } ),
				} ),
			] )
		);
	} );
} );

function assistantToolCallEntry( name: string ): SessionEntry {
	return {
		type: 'message',
		id: `assistant-${ name }`,
		parentId: null,
		timestamp: '2026-05-13T00:00:00.000Z',
		message: {
			role: 'assistant',
			content: [
				{
					type: 'toolCall',
					id: 'tool-call-1',
					name,
					arguments: {},
				},
			],
		},
	} as unknown as SessionEntry;
}

function toolResultEntry( text: string ): SessionEntry {
	return {
		type: 'message',
		id: 'tool-result',
		parentId: null,
		timestamp: '2026-05-13T00:00:01.000Z',
		message: {
			role: 'toolResult',
			toolCallId: 'tool-call-1',
			content: [ { type: 'text', text } ],
		},
	} as unknown as SessionEntry;
}

function chatArtifactEntry(): SessionEntry {
	return {
		type: 'custom',
		id: 'artifact',
		parentId: null,
		timestamp: '2026-05-13T00:00:02.000Z',
		customType: 'studio.chat_artifact',
		data: {
			version: STUDIO_CHAT_ARTIFACT_VERSION,
			id: 'artifact-1',
			widgets: [
				{
					type: 'post-collection',
					widgetProps: {
						query: {
							postType: 'post',
							perPage: 5,
							status: 'publish',
							orderby: 'date',
							order: 'desc',
						},
					},
				},
			],
		},
	} as unknown as SessionEntry;
}
