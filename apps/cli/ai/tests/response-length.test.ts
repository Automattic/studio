import {
	createResponseLengthExtension,
	RESPONSE_LENGTH_INSTRUCTIONS,
} from 'cli/ai/extensions/response-length';
import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionAPI,
} from '@earendil-works/pi-coding-agent';
import type { AiResponseLength } from '@studio/common/ai/response-length';

type BeforeAgentStartHandler = (
	event: BeforeAgentStartEvent,
	ctx: unknown
) => BeforeAgentStartEventResult | void | Promise< BeforeAgentStartEventResult | void >;

const BASE_SYSTEM_PROMPT = 'You are the Studio agent.';

async function runBeforeAgentStart(
	level?: AiResponseLength
): Promise< BeforeAgentStartEventResult | void > {
	let handler: BeforeAgentStartHandler | undefined;
	const pi = {
		on: ( event: string, fn: BeforeAgentStartHandler ) => {
			if ( event === 'before_agent_start' ) {
				handler = fn;
			}
		},
	} as unknown as ExtensionAPI;

	await createResponseLengthExtension( level )( pi );
	expect( handler ).toBeDefined();
	return handler!(
		{
			type: 'before_agent_start',
			prompt: 'Add a contact form',
			systemPrompt: BASE_SYSTEM_PROMPT,
			systemPromptOptions: {},
		} as BeforeAgentStartEvent,
		{}
	);
}

describe( 'createResponseLengthExtension', () => {
	it( 'leaves the system prompt untouched for normal', async () => {
		expect( await runBeforeAgentStart( 'normal' ) ).toBeUndefined();
	} );

	it( 'defaults to normal when no level is given', async () => {
		expect( await runBeforeAgentStart() ).toBeUndefined();
	} );

	it.each( [ 'compact', 'verbose' ] as const )(
		'appends the %s instruction after the base prompt',
		async ( level ) => {
			const result = await runBeforeAgentStart( level );
			expect( result?.systemPrompt ).toBe(
				`${ BASE_SYSTEM_PROMPT }\n\n${ RESPONSE_LENGTH_INSTRUCTIONS[ level ] }`
			);
		}
	);

	it( 'keeps compact and verbose instructions distinct and non-empty', () => {
		expect( RESPONSE_LENGTH_INSTRUCTIONS.compact ).not.toBe( '' );
		expect( RESPONSE_LENGTH_INSTRUCTIONS.verbose ).not.toBe( '' );
		expect( RESPONSE_LENGTH_INSTRUCTIONS.compact ).not.toBe( RESPONSE_LENGTH_INSTRUCTIONS.verbose );
	} );
} );
