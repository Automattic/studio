import { DEFAULT_MODEL } from '@studio/common/ai/models';
import { describe, expect, it } from 'vitest';
import { version as cliVersion } from '../../package.json';
import { getAiProviderDefinition } from '../providers';

// Compaction requests are generated inside pi with its own summarization
// system prompt, not Studio's. pi exposes no setting for it, so pin the exact
// text: a pi upgrade that changes it fails here, prompting an end-to-end
// re-verification of compaction before the bump lands.
const EXPECTED_SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`;

// The constant lives in a module the package's exports map does not expose,
// so resolve the package entry and import the file directly.
async function loadSummarizationSystemPrompt(): Promise< string > {
	const packageEntry = import.meta.resolve( '@earendil-works/pi-coding-agent' );
	const utils = await import( new URL( './core/compaction/utils.js', packageEntry ).href );
	return utils.SUMMARIZATION_SYSTEM_PROMPT;
}

describe( 'compaction summarization prompt', () => {
	it( 'matches the pinned pi summarization system prompt', async () => {
		expect( await loadSummarizationSystemPrompt() ).toBe( EXPECTED_SUMMARIZATION_SYSTEM_PROMPT );
	} );
} );

// Live check that a compaction-shaped request completes against the wpcom AI
// gateway, using the same environment the agent runs with. Opt-in because it
// hits the network and needs a WordPress.com login (`studio auth login`):
//   STUDIO_LIVE_AI_TESTS=1 npm test -- apps/cli/ai/tests/compaction.test.ts
describe.runIf( process.env.STUDIO_LIVE_AI_TESTS === '1' )( 'compaction request (live)', () => {
	it( 'completes against the wpcom AI gateway', { timeout: 30_000 }, async () => {
		const env = await getAiProviderDefinition( 'wpcom' ).resolveEnv();
		const headers: Record< string, string > = {
			Authorization: `Bearer ${ env.ANTHROPIC_AUTH_TOKEN }`,
			'content-type': 'application/json',
			'anthropic-version': '2023-06-01',
		};
		for ( const line of env.ANTHROPIC_CUSTOM_HEADERS.split( '\n' ) ) {
			const separator = line.indexOf( ': ' );
			headers[ line.slice( 0, separator ) ] = line.slice( separator + 2 );
		}
		// Tests run unbundled, so the build-time CLI version behind the default
		// User-Agent is unavailable; reconstruct it from the package manifest.
		headers[ 'User-Agent' ] = `WordPressStudio/${ cliVersion }`;

		const response = await fetch( `${ env.ANTHROPIC_BASE_URL }/v1/messages`, {
			method: 'POST',
			headers,
			body: JSON.stringify( {
				model: DEFAULT_MODEL,
				max_tokens: 1,
				system: await loadSummarizationSystemPrompt(),
				messages: [ { role: 'user', content: 'hi' } ],
			} ),
		} );

		expect( response.status, await response.text() ).toBe( 200 );
	} );
} );
