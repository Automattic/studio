import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiChatUI } from 'cli/ai/ui';

vi.mock( '@mariozechner/pi-tui', () => {
	class Container {
		children: unknown[] = [];

		addChild( child: unknown ) {
			this.children.push( child );
		}

		removeChild( child: unknown ) {
			this.children = this.children.filter( ( item ) => item !== child );
		}
	}

	class Text {
		text: string;

		constructor( text: string ) {
			this.text = text;
		}

		setText( text: string ) {
			this.text = text;
		}
	}

	class Markdown extends Text {}

	class Loader {
		frames: string[] = [];

		start() {}

		stop() {}

		setMessage() {}
	}

	class Editor {
		focused = false;
		onSubmit?: ( text: string ) => void;
		private text = '';

		constructor( ..._args: unknown[] ) {}

		setText( text: string ) {
			this.text = text;
		}

		getText() {
			return this.text;
		}

		handleInput() {}

		setAutocompleteProvider() {}

		invalidate() {}

		render() {
			return [ '', '', '' ];
		}
	}

	class TUI {
		children: unknown[] = [];

		constructor( ..._args: unknown[] ) {}

		addChild( child: unknown ) {
			this.children.push( child );
		}

		removeChild( child: unknown ) {
			this.children = this.children.filter( ( item ) => item !== child );
		}

		setFocus() {}

		addInputListener() {}

		requestRender() {}

		start() {}

		stop() {}
	}

	class ProcessTerminal {}

	class CombinedAutocompleteProvider {
		constructor( ..._args: unknown[] ) {}
	}

	return {
		TUI,
		ProcessTerminal,
		Editor,
		Markdown,
		Text,
		Loader,
		Container,
		CombinedAutocompleteProvider,
		matchesKey: () => false,
		isKeyRelease: () => false,
	};
} );

vi.mock( 'cli/ai/agent', () => ( {
	AI_MODELS: {
		sonnet: 'Sonnet',
	},
	DEFAULT_MODEL: 'sonnet',
} ) );

vi.mock( 'cli/ai/slash-commands', () => ( {
	AI_CHAT_SLASH_COMMANDS: [],
} ) );

vi.mock( 'cli/lib/appdata', () => ( {
	getSiteUrl: () => 'http://example.com',
	readAppdata: vi.fn(),
} ) );

vi.mock( 'cli/lib/browser', () => ( {
	openBrowser: vi.fn(),
} ) );

vi.mock( 'cli/lib/site-utils', () => ( {
	isSiteRunning: vi.fn(),
} ) );

describe( 'AiChatUI tool rendering', () => {
	beforeEach( () => {
		vi.useFakeTimers();
	} );

	it( 'keeps only one visible pending tool row when tool_use blocks arrive back to back', () => {
		const ui = new AiChatUI();

		ui.handleMessage( {
			type: 'assistant',
			message: {
				content: [
					{
						type: 'tool_use',
						id: 'tool-1',
						name: 'Bash',
						input: { command: 'ls' },
					},
					{
						type: 'tool_use',
						id: 'tool-2',
						name: 'Bash',
						input: { command: 'pwd' },
					},
				],
			},
		} as never );

		const { messages, pendingToolCalls } = ui as unknown as {
			messages: { children: Array< { text?: string } > };
			pendingToolCalls: Map< string, unknown >;
		};
		const visiblePendingRows = messages.children.filter(
			( child ) => child.text?.includes( 'Run' )
		);

		expect( pendingToolCalls.size ).toBe( 2 );
		expect( visiblePendingRows ).toHaveLength( 1 );

		ui.endAgentTurn();
	} );

	it( 'uses the correct labels when tool results arrive out of order', () => {
		const ui = new AiChatUI();

		ui.handleMessage( {
			type: 'assistant',
			message: {
				content: [
					{
						type: 'tool_use',
						id: 'tool-1',
						name: 'Bash',
						input: { command: 'ls' },
					},
					{
						type: 'tool_use',
						id: 'tool-2',
						name: 'Bash',
						input: { command: 'pwd' },
					},
				],
			},
		} as never );

		ui.handleMessage( {
			type: 'user',
			parent_tool_use_id: 'tool-1',
			message: { role: 'user', content: [] },
			tool_use_result: { content: 'first result' },
			session_id: 'session',
		} as never );

		ui.handleMessage( {
			type: 'user',
			parent_tool_use_id: 'tool-2',
			message: { role: 'user', content: [] },
			tool_use_result: { content: 'second result' },
			session_id: 'session',
		} as never );

		const { activeToolCheckpoint, messages, pendingToolCalls, activePendingToolCallId } =
			ui as unknown as {
				activeToolCheckpoint: { groups: Array< { label: string } > } | null;
				messages: { children: Array< { text?: string } > };
				pendingToolCalls: Map< string, unknown >;
				activePendingToolCallId: string | null;
			};

		expect( activeToolCheckpoint?.groups.map( ( group ) => group.label ) ).toEqual( [
			expect.stringContaining( 'ls' ),
			expect.stringContaining( 'pwd' ),
		] );
		expect( pendingToolCalls.size ).toBe( 0 );
		expect( activePendingToolCallId ).toBeNull();
		expect( messages.children.filter( ( child ) => child.text?.includes( 'Run' ) ) ).toHaveLength(
			0
		);

		ui.endAgentTurn();
	} );

	it( 'falls back to the active pending tool when a result has no parent tool id', () => {
		const ui = new AiChatUI();

		ui.handleMessage( {
			type: 'assistant',
			message: {
				content: [
					{
						type: 'tool_use',
						id: 'tool-1',
						name: 'Edit',
						input: { file_path: '/Users/dethier/project/style.css' },
					},
				],
			},
		} as never );

		ui.handleMessage( {
			type: 'user',
			parent_tool_use_id: null,
			message: { role: 'user', content: [] },
			tool_use_result: { content: 'updated css' },
			session_id: 'session',
		} as never );

		const { activeToolCheckpoint } = ui as unknown as {
			activeToolCheckpoint: { groups: Array< { label: string } > } | null;
		};

		expect( activeToolCheckpoint?.groups.map( ( group ) => group.label ) ).toEqual( [
			expect.stringContaining( 'Edit' ),
		] );
		expect( activeToolCheckpoint?.groups.map( ( group ) => group.label ) ).not.toEqual( [
			expect.stringContaining( 'Tool' ),
		] );

		ui.endAgentTurn();
	} );
} );
