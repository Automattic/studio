import { classifyTurnError, createTurnStatsTracker, getTurnSiteKind } from 'cli/ai/turn-stats';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

function toolEnd( toolName: string, isError = false ): AgentSessionEvent {
	return {
		type: 'tool_execution_end',
		toolCallId: `${ toolName }-id`,
		toolName,
		result: { content: [ { type: 'text', text: 'secret output /Users/me/site' } ] },
		isError,
	} as AgentSessionEvent;
}

function assistantEnd( input: number, output: number ): AgentSessionEvent {
	return {
		type: 'message_end',
		message: {
			role: 'assistant',
			content: [ { type: 'text', text: 'Done! I fixed it.' } ],
			stopReason: 'stop',
			timestamp: 0,
			usage: {
				input,
				output,
				cacheRead: 10,
				cacheWrite: 5,
				totalTokens: input + output + 15,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
		},
	} as unknown as AgentSessionEvent;
}

function userEnd(): AgentSessionEvent {
	return {
		type: 'message_end',
		message: { role: 'user', content: 'hello', timestamp: 0 },
	} as unknown as AgentSessionEvent;
}

const STUDIO_TOOLS = new Set( [ 'Bash', 'Edit', 'Read', 'Write', 'wp_cli', 'take_screenshot' ] );
const hasTool = ( name: string ) => STUDIO_TOOLS.has( name );

function propsFor( events: AgentSessionEvent[], outcome: 'success' | 'error' = 'success' ) {
	const tracker = createTurnStatsTracker();
	events.forEach( ( event ) => tracker.handleEvent( event ) );
	return tracker.getProps( { outcome, site: null, hasTool } );
}

function skillStart( args: unknown ): AgentSessionEvent {
	return {
		type: 'tool_execution_start',
		toolCallId: 'Skill-id',
		toolName: 'Skill',
		args,
	} as AgentSessionEvent;
}

describe( 'createTurnStatsTracker', () => {
	it.each( [
		{
			name: 'two skills, one loaded twice',
			events: [
				skillStart( { name: 'visual-design' } ),
				skillStart( { name: 'rank-me-up' } ),
				skillStart( { name: 'visual-design' } ),
			],
			expected: 'rank-me-up,visual-design',
		},
		{
			name: 'a name Studio ships no skill for',
			events: [ skillStart( { name: '/Users/me/notes' } ), skillStart( {} ) ],
			expected: '',
		},
		{
			name: 'a site named after a skill',
			events: [
				{
					type: 'tool_execution_start',
					toolCallId: 'site_create-id',
					toolName: 'site_create',
					args: { name: 'liberate' },
				} as AgentSessionEvent,
			],
			expected: '',
		},
	] )( 'reports the skills loaded in a turn: $name', ( { events, expected } ) => {
		expect( propsFor( events ).skills_loaded ).toBe( expected );
	} );

	it( 'reports zeroes for a turn with no tools or model responses', () => {
		expect( propsFor( [] ) ).toEqual( {
			tool_calls: 0,
			tool_errors: 0,
			failed_tools: '',
			skills_loaded: '',
			edits: 0,
			model_requests: 0,
			input_tokens: 0,
			output_tokens: 0,
			cache_read_tokens: 0,
			cache_write_tokens: 0,
			site_kind: 'none',
		} );
	} );

	it( 'counts finished tool calls and the ones that errored', () => {
		const props = propsFor( [
			toolEnd( 'Read' ),
			toolEnd( 'wp_cli', true ),
			toolEnd( 'Bash' ),
			toolEnd( 'wp_cli', true ),
			toolEnd( 'Bash', true ),
		] );
		expect( props.tool_calls ).toBe( 5 );
		expect( props.tool_errors ).toBe( 3 );
		expect( props.failed_tools ).toBe( 'Bash,wp_cli' );
	} );

	it( 'reports a tool the model made up as unknown, not by the name it wrote', () => {
		// pi ends a call to a missing tool with the model's name for it.
		const props = propsFor( [
			toolEnd( 'Bsah', true ),
			toolEnd( 'skill', true ),
			toolEnd( 'wp_cli', true ),
		] );
		expect( props.tool_errors ).toBe( 3 );
		expect( props.failed_tools ).toBe( 'unknown,wp_cli' );
	} );

	it( 'ignores tool starts and updates', () => {
		const props = propsFor( [
			{ type: 'tool_execution_start', toolCallId: 'a', toolName: 'Read', args: {} },
			{
				type: 'tool_execution_update',
				toolCallId: 'a',
				toolName: 'Read',
				args: {},
				partialResult: {},
			},
		] as AgentSessionEvent[] );
		expect( props.tool_calls ).toBe( 0 );
	} );

	it( 'lists each failing tool once, sorted', () => {
		const props = propsFor( [
			toolEnd( 'wp_cli', true ),
			toolEnd( 'Edit', true ),
			toolEnd( 'wp_cli', true ),
		] );
		expect( props.failed_tools ).toBe( 'Edit,wp_cli' );
		expect( props.tool_errors ).toBe( 3 );
	} );

	it( 'counts only successful Write and Edit calls as edits', () => {
		const props = propsFor( [
			toolEnd( 'Write' ),
			toolEnd( 'Edit' ),
			toolEnd( 'Edit', true ),
			toolEnd( 'Read' ),
		] );
		expect( props.edits ).toBe( 2 );
	} );

	it( 'counts assistant responses and sums their usage', () => {
		const props = propsFor( [ userEnd(), assistantEnd( 100, 20 ), assistantEnd( 300, 40 ) ] );
		expect( props.model_requests ).toBe( 2 );
		expect( props.input_tokens ).toBe( 400 );
		expect( props.output_tokens ).toBe( 60 );
		expect( props.cache_read_tokens ).toBe( 20 );
		expect( props.cache_write_tokens ).toBe( 10 );
	} );

	it( "adds what a tool call spent on a model of its own, as a subagent's turn", () => {
		const subagent = {
			...toolEnd( 'subagent' ),
			result: {
				content: [],
				details: { usage: { input: 50, output: 7, cacheRead: 3, cacheWrite: 1, totalTokens: 61 } },
			},
		} as AgentSessionEvent;
		const props = propsFor( [ assistantEnd( 100, 20 ), subagent ] );
		expect( props.model_requests ).toBe( 1 );
		expect( props ).toMatchObject( {
			input_tokens: 150,
			output_tokens: 27,
			cache_read_tokens: 13,
			cache_write_tokens: 6,
		} );
	} );

	it( 'keeps counting across an attempt that will be retried', () => {
		const tracker = createTurnStatsTracker();
		tracker.handleEvent( assistantEnd( 100, 0 ) );
		tracker.handleEvent( {
			type: 'agent_end',
			messages: [],
			willRetry: true,
		} as unknown as AgentSessionEvent );
		tracker.handleEvent( assistantEnd( 50, 10 ) );
		tracker.handleEvent( toolEnd( 'Read' ) );
		const props = tracker.getProps( { outcome: 'success', site: null, hasTool } );
		expect( props.model_requests ).toBe( 2 );
		expect( props.input_tokens ).toBe( 150 );
		expect( props.tool_calls ).toBe( 1 );
	} );

	it( 'adds error_kind only when the turn errored', () => {
		const tracker = createTurnStatsTracker();
		expect(
			tracker.getProps( { outcome: 'success', failure: '429', hasTool } )
		).not.toHaveProperty( 'error_kind' );
		expect( tracker.getProps( { outcome: 'interrupted', hasTool } ) ).not.toHaveProperty(
			'error_kind'
		);
		expect(
			tracker.getProps( { outcome: 'error', failure: '429 Too Many Requests', hasTool } )
		).toMatchObject( { error_kind: 'rate_limited' } );
		expect( tracker.getProps( { outcome: 'error', hasTool } ) ).toMatchObject( {
			error_kind: 'other',
		} );
	} );

	it( 'reports the site kind', () => {
		const tracker = createTurnStatsTracker();
		expect( tracker.getProps( { outcome: 'success', site: {}, hasTool } ).site_kind ).toBe(
			'local'
		);
		expect(
			tracker.getProps( {
				outcome: 'success',
				site: { remote: { host: 'wpcom', id: 7 } },
				hasTool,
			} ).site_kind
		).toBe( 'wpcom' );
	} );

	it( 'never carries free text into a prop', () => {
		const tracker = createTurnStatsTracker();
		tracker.handleEvent( assistantEnd( 1, 1 ) );
		tracker.handleEvent( toolEnd( 'wp_cli', true ) );
		tracker.handleEvent( toolEnd( 'read_secret_acme_file', true ) );
		const props = tracker.getProps( {
			outcome: 'error',
			failure: new Error( 'Could not write /Users/me/Studio/acme-shop/wp-config.php' ),
			site: {},
			hasTool,
		} );
		const serialized = JSON.stringify( Object.values( props ) );
		expect( serialized ).not.toMatch( /Users|acme|secret|wp-config|Done|output/ );
		for ( const value of Object.values( props ) ) {
			expect( [ 'number', 'boolean', 'string' ] ).toContain( typeof value );
		}
	} );
} );

describe( 'getTurnSiteKind', () => {
	it( 'distinguishes local, WordPress.com and no site', () => {
		expect( getTurnSiteKind( {} ) ).toBe( 'local' );
		expect( getTurnSiteKind( { remote: { host: 'wpcom', id: 7 } } ) ).toBe( 'wpcom' );
		expect( getTurnSiteKind( undefined ) ).toBe( 'none' );
		expect( getTurnSiteKind( null ) ).toBe( 'none' );
	} );
} );

describe( 'classifyTurnError', () => {
	it.each( [
		[
			'402 {"code":"studio_out_of_credits","message":"studio_out_of_credits: buy more"}',
			'out_of_credits',
		],
		[ 'Monthly usage limit reached: 429 cost_cap_exceeded', 'out_of_credits' ],
		[ '401 Unauthorized', 'auth' ],
		[ '403 Forbidden', 'auth' ],
		[ 'invalid x-api-key', 'auth' ],
		[ 'No API key configured for Anthropic', 'auth' ],
		[ 'studio_code_ai_disabled', 'auth' ],
		[ 'studio_code_ai_access_required', 'auth' ],
		[
			'404 {"type":"not_found_error","message":"model: claude-foo"} model not found',
			'model_unavailable',
		],
		[ 'Unknown model "gpt-9"', 'model_unavailable' ],
		[ 'The model claude-x is not supported by this provider', 'model_unavailable' ],
		[ '429 Too Many Requests', 'rate_limited' ],
		[ 'Rate limit exceeded, try again later', 'rate_limited' ],
		[ 'fetch failed', 'network' ],
		[ 'connect ECONNREFUSED 127.0.0.1:443', 'network' ],
		[ 'Request timed out', 'network' ],
		[ 'Claude Code process exited with code 1', 'other' ],
		[ '', 'other' ],
	] )( 'classifies %j as %s', ( message, kind ) => {
		expect( classifyTurnError( message ) ).toBe( kind );
		expect( classifyTurnError( new Error( message ) ) ).toBe( kind );
	} );

	it( 'reads the status and code of a caught error', () => {
		expect( classifyTurnError( Object.assign( new Error( 'boom' ), { status: 401 } ) ) ).toBe(
			'auth'
		);
		expect( classifyTurnError( Object.assign( new Error( 'boom' ), { status: 429 } ) ) ).toBe(
			'rate_limited'
		);
		expect(
			classifyTurnError( Object.assign( new Error( 'boom' ), { cause: { code: 'ENOTFOUND' } } ) )
		).toBe( 'network' );
	} );

	it( 'handles failures that are not errors or strings', () => {
		expect( classifyTurnError( undefined ) ).toBe( 'other' );
		expect( classifyTurnError( null ) ).toBe( 'other' );
		expect( classifyTurnError( 42 ) ).toBe( 'other' );
	} );
} );
