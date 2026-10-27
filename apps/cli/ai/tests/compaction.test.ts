import { describe, expect, it } from 'vitest';

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
