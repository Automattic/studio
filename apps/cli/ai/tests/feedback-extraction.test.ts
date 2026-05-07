import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractFeedbackFields, parseFeedbackExtraction } from 'cli/ai/feedback-extraction';

vi.mock( 'cli/ai/auth', () => ( {
	resolveAiEnvironment: vi.fn(),
} ) );

describe( 'parseFeedbackExtraction', () => {
	it( 'returns null for non-JSON output', () => {
		expect( parseFeedbackExtraction( 'sorry, I can only respond with JSON' ) ).toBeNull();
	} );

	it( 'returns null for valid JSON that is not a plain object', () => {
		expect( parseFeedbackExtraction( '"a string"' ) ).toBeNull();
		expect( parseFeedbackExtraction( '[1, 2, 3]' ) ).toBeNull();
		expect( parseFeedbackExtraction( '42' ) ).toBeNull();
		expect( parseFeedbackExtraction( 'null' ) ).toBeNull();
	} );

	it( 'strips ```json fences if the model wraps its output despite instructions', () => {
		const wrapped =
			'```json\n{"title":"hello","steps":null,"expected":null,"actual":null,"impact":null,"workaround":null}\n```';
		const parsed = parseFeedbackExtraction( wrapped );
		expect( parsed?.title ).toBe( 'hello' );
	} );

	it( 'rejects an out-of-vocabulary impact label', () => {
		const json =
			'{"title":"x","steps":null,"expected":null,"actual":null,"impact":"some users","workaround":null}';
		expect( parseFeedbackExtraction( json )?.impact ).toBeNull();
	} );

	it( 'accepts the canonical impact and workaround labels', () => {
		const json = JSON.stringify( {
			title: 'x',
			steps: null,
			expected: null,
			actual: null,
			impact: 'Most (> 50%)',
			workaround: 'Yes, easy to implement',
		} );
		const parsed = parseFeedbackExtraction( json );
		expect( parsed?.impact ).toBe( 'Most (> 50%)' );
		expect( parsed?.workaround ).toBe( 'Yes, easy to implement' );
	} );

	it( 'coerces empty-string fields to null', () => {
		const json = JSON.stringify( {
			title: '',
			steps: '   ',
			expected: 'real value',
			actual: null,
			impact: null,
			workaround: null,
		} );
		const parsed = parseFeedbackExtraction( json );
		expect( parsed?.title ).toBeNull();
		expect( parsed?.steps ).toBeNull();
		expect( parsed?.expected ).toBe( 'real value' );
	} );
} );

describe( 'extractFeedbackFields orchestration', () => {
	let fetchSpy: ReturnType< typeof vi.spyOn >;

	beforeEach( async () => {
		const auth = await import( 'cli/ai/auth' );
		( auth.resolveAiEnvironment as ReturnType< typeof vi.fn > ).mockReset();
		fetchSpy = vi.spyOn( global, 'fetch' );
	} );

	afterEach( () => {
		fetchSpy.mockRestore();
	} );

	it( 'returns null when resolveAiEnvironment throws (e.g. not authenticated)', async () => {
		const auth = await import( 'cli/ai/auth' );
		( auth.resolveAiEnvironment as ReturnType< typeof vi.fn > ).mockRejectedValue(
			new Error( 'auth required' )
		);

		const result = await extractFeedbackFields( 'something broken', {
			provider: 'wpcom',
			model: 'claude-sonnet-4-6',
		} );
		expect( result ).toBeNull();
		expect( fetchSpy ).not.toHaveBeenCalled();
	} );

	it( 'returns null when Anthropic credentials are missing in the resolved env', async () => {
		const auth = await import( 'cli/ai/auth' );
		( auth.resolveAiEnvironment as ReturnType< typeof vi.fn > ).mockResolvedValue( {
			ANTHROPIC_BASE_URL: 'https://example.test',
			// No AUTH_TOKEN, no API_KEY
		} );

		const result = await extractFeedbackFields( 'broken', {
			provider: 'wpcom',
			model: 'claude-sonnet-4-6',
		} );
		expect( result ).toBeNull();
		expect( fetchSpy ).not.toHaveBeenCalled();
	} );

	it( 'sends Anthropic line-format custom headers (NOT JSON) on the wpcom proxy path', async () => {
		const auth = await import( 'cli/ai/auth' );
		( auth.resolveAiEnvironment as ReturnType< typeof vi.fn > ).mockResolvedValue( {
			ANTHROPIC_BASE_URL: 'https://wpcom.example/proxy',
			ANTHROPIC_AUTH_TOKEN: 'abc123',
			ANTHROPIC_CUSTOM_HEADERS:
				'X-WPCOM-AI-Feature: studio-assistant-anthropic\nX-WPCOM-Session-ID: session-1',
		} );
		fetchSpy.mockResolvedValue(
			new Response(
				JSON.stringify( {
					content: [
						{
							type: 'text',
							text: '{"title":"x","steps":null,"expected":null,"actual":null,"impact":null,"workaround":null}',
						},
					],
				} ),
				{ status: 200 }
			)
		);

		await extractFeedbackFields( 'a problem', {
			provider: 'wpcom',
			model: 'claude-sonnet-4-6',
		} );

		expect( fetchSpy ).toHaveBeenCalledOnce();
		const [ url, init ] = fetchSpy.mock.calls[ 0 ] as [ string, RequestInit ];
		expect( url ).toBe( 'https://wpcom.example/proxy/v1/messages' );
		const headers = init.headers as Record< string, string >;
		expect( headers.authorization ).toBe( 'Bearer abc123' );
		expect( headers[ 'X-WPCOM-AI-Feature' ] ).toBe( 'studio-assistant-anthropic' );
		expect( headers[ 'X-WPCOM-Session-ID' ] ).toBe( 'session-1' );
	} );

	it( 'uses x-api-key for direct Anthropic when only ANTHROPIC_API_KEY is set', async () => {
		const auth = await import( 'cli/ai/auth' );
		( auth.resolveAiEnvironment as ReturnType< typeof vi.fn > ).mockResolvedValue( {
			ANTHROPIC_API_KEY: 'sk-ant-xyz',
		} );
		fetchSpy.mockResolvedValue(
			new Response(
				JSON.stringify( {
					content: [
						{
							type: 'text',
							text: '{"title":"x","steps":null,"expected":null,"actual":null,"impact":null,"workaround":null}',
						},
					],
				} ),
				{ status: 200 }
			)
		);

		await extractFeedbackFields( 'a problem', {
			provider: 'anthropic-api-key',
			model: 'claude-opus-4-7',
		} );

		const [ url, init ] = fetchSpy.mock.calls[ 0 ] as [ string, RequestInit ];
		// Falls back to the public Anthropic endpoint when no base URL is set.
		expect( url ).toBe( 'https://api.anthropic.com/v1/messages' );
		const headers = init.headers as Record< string, string >;
		expect( headers[ 'x-api-key' ] ).toBe( 'sk-ant-xyz' );
		expect( headers.authorization ).toBeUndefined();
	} );

	it( 'routes OpenAI models to /chat/completions with json_object response_format', async () => {
		const auth = await import( 'cli/ai/auth' );
		( auth.resolveAiEnvironment as ReturnType< typeof vi.fn > ).mockResolvedValue( {
			OPENAI_BASE_URL: 'https://wpcom.example/proxy/v1',
			OPENAI_API_KEY: 'wpcom-token',
			STUDIO_OPENAI_DEFAULT_HEADERS: '{"X-WPCOM-AI-Feature":"studio-assistant"}',
		} );
		fetchSpy.mockResolvedValue(
			new Response(
				JSON.stringify( {
					choices: [
						{
							message: {
								content:
									'{"title":"y","steps":null,"expected":null,"actual":null,"impact":null,"workaround":null}',
							},
						},
					],
				} ),
				{ status: 200 }
			)
		);

		await extractFeedbackFields( 'a problem', { provider: 'wpcom', model: 'gpt-5.5' } );

		const [ url, init ] = fetchSpy.mock.calls[ 0 ] as [ string, RequestInit ];
		expect( url ).toBe( 'https://wpcom.example/proxy/v1/chat/completions' );
		const body = JSON.parse( init.body as string );
		expect( body.response_format ).toEqual( { type: 'json_object' } );
		expect( body.model ).toBe( 'gpt-5.5' );
		const headers = init.headers as Record< string, string >;
		expect( headers[ 'X-WPCOM-AI-Feature' ] ).toBe( 'studio-assistant' );
	} );

	it( 'returns null when fetch responds with a non-2xx status', async () => {
		const auth = await import( 'cli/ai/auth' );
		( auth.resolveAiEnvironment as ReturnType< typeof vi.fn > ).mockResolvedValue( {
			ANTHROPIC_BASE_URL: 'https://wpcom.example/proxy',
			ANTHROPIC_AUTH_TOKEN: 'abc',
		} );
		fetchSpy.mockResolvedValue( new Response( '{}', { status: 500 } ) );

		const result = await extractFeedbackFields( 'broken', {
			provider: 'wpcom',
			model: 'claude-sonnet-4-6',
		} );
		expect( result ).toBeNull();
	} );

	it( 'returns null when fetch throws (network error / abort)', async () => {
		const auth = await import( 'cli/ai/auth' );
		( auth.resolveAiEnvironment as ReturnType< typeof vi.fn > ).mockResolvedValue( {
			ANTHROPIC_BASE_URL: 'https://wpcom.example/proxy',
			ANTHROPIC_AUTH_TOKEN: 'abc',
		} );
		fetchSpy.mockRejectedValue( new DOMException( 'aborted', 'AbortError' ) );

		const result = await extractFeedbackFields( 'broken', {
			provider: 'wpcom',
			model: 'claude-sonnet-4-6',
		} );
		expect( result ).toBeNull();
	} );

	it( 'parses extracted fields end-to-end on a successful Anthropic response', async () => {
		const auth = await import( 'cli/ai/auth' );
		( auth.resolveAiEnvironment as ReturnType< typeof vi.fn > ).mockResolvedValue( {
			ANTHROPIC_BASE_URL: 'https://wpcom.example/proxy',
			ANTHROPIC_AUTH_TOKEN: 'abc',
		} );
		fetchSpy.mockResolvedValue(
			new Response(
				JSON.stringify( {
					content: [
						{
							type: 'text',
							text: JSON.stringify( {
								title: 'Sites fail to start',
								steps: '1. Update Studio.\n2. Click Start.',
								expected: 'Site starts.',
								actual: 'Spinner forever.',
								impact: 'All',
								workaround: 'No and the app is unusable',
							} ),
						},
					],
				} ),
				{ status: 200 }
			)
		);

		const result = await extractFeedbackFields(
			'After updating, sites just spin. The app is dead.',
			{ provider: 'wpcom', model: 'claude-sonnet-4-6' }
		);
		expect( result?.title ).toBe( 'Sites fail to start' );
		expect( result?.impact ).toBe( 'All' );
		expect( result?.workaround ).toBe( 'No and the app is unusable' );
	} );
} );
