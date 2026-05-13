import { STUDIO_CHAT_ARTIFACT_VERSION } from '@studio/common/ai/chat-artifacts';
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatArtifact, entriesToRenderItems } from './index';
import type { SessionEntry } from '@mariozechner/pi-coding-agent';

const deskMocks = vi.hoisted( () => ( {
	addWidget: vi.fn(),
	addWidgetAtScreenPoint: vi.fn(),
} ) );

vi.mock( '@/components/markdown', () => ( {
	Markdown: () => null,
} ) );

vi.mock( '@/ui-desks/components', () => ( {
	Button: () => null,
} ) );

vi.mock( '@/ui-desks/desk/provider', () => ( {
	useDesk: () => ( {
		addWidget: deskMocks.addWidget,
		addWidgetAtScreenPoint: deskMocks.addWidgetAtScreenPoint,
		canAddWidgets: true,
	} ),
} ) );

vi.mock( '@/ui-desks/widget-actions/create-widget', () => ( {
	createDeskWidget: vi.fn(
		( options: {
			id: string;
			type: string;
			zIndex: string;
			shapeProps?: Record< string, unknown >;
			widgetProps?: Record< string, unknown >;
		} ) => ( {
			id: options.id,
			type: options.type,
			x: 0,
			y: 0,
			zIndex: options.zIndex,
			shapeProps: { w: 120, h: 96, ...options.shapeProps },
			widgetProps: options.widgetProps ?? {},
		} )
	),
} ) );

vi.mock( '@wordpress/icons', () => ( {
	check: {},
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
	getWidgetDisplayLabel: ( widget: { type: string } ) => `${ widget.type } widget`,
	WidgetContextThumbnail: () => null,
	WidgetContextThumbnailList: () => null,
} ) );

describe( 'desks conversation render items', () => {
	beforeEach( () => {
		deskMocks.addWidget.mockReset();
		deskMocks.addWidgetAtScreenPoint.mockReset();
	} );

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

	it( 'adds widgets from multi-widget artifacts independently', () => {
		deskMocks.addWidget.mockReturnValue( true );

		render(
			createElement( ChatArtifact, {
				artifact: {
					version: STUDIO_CHAT_ARTIFACT_VERSION,
					id: 'artifact-2',
					widgets: [
						{
							type: 'note',
							widgetProps: { text: 'First note', tone: 'yellow' },
						},
						{
							type: 'bookmark',
							widgetProps: { url: 'https://example.com' },
						},
					],
				},
			} )
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Add widget 2 to canvas: bookmark widget' } )
		);

		expect( deskMocks.addWidget ).toHaveBeenCalledTimes( 1 );
		expect( deskMocks.addWidget ).toHaveBeenCalledWith(
			'bookmark',
			expect.objectContaining( {
				widgetProps: { url: 'https://example.com' },
				shouldStartEditing: false,
			} )
		);
		expect(
			screen.getByRole( 'button', { name: 'Added widget 2 to canvas: bookmark widget' } )
		).toBeDisabled();

		fireEvent.click( screen.getByRole( 'button', { name: 'Add remaining' } ) );

		expect( deskMocks.addWidget ).toHaveBeenCalledTimes( 2 );
		expect( deskMocks.addWidget ).toHaveBeenLastCalledWith(
			'note',
			expect.objectContaining( {
				widgetProps: { text: 'First note', tone: 'yellow' },
				shouldStartEditing: false,
			} )
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
