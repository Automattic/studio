const GEMINI_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1';
const VALIDATION_TIMEOUT_MS = 10_000;

export type GeminiKeyValidation =
	| { status: 'valid' }
	| { status: 'invalid'; message: string }
	| { status: 'unverifiable'; message: string };

/**
 * Checks a Google Gemini API key against the live Generative Language API with
 * a cheap authenticated request (listing models consumes no tokens).
 *
 * Google's API returns 400 (API_KEY_INVALID) as well as 401/403 for rejected
 * keys; rate limits, server errors, and network failures report `unverifiable`
 * so callers can accept keys while offline or during an outage.
 */
export async function validateGeminiApiKey( apiKey: string ): Promise< GeminiKeyValidation > {
	let response: Response;
	try {
		response = await fetch( GEMINI_MODELS_URL, {
			headers: {
				'x-goog-api-key': apiKey,
			},
			signal: AbortSignal.timeout( VALIDATION_TIMEOUT_MS ),
		} );
	} catch {
		return {
			status: 'unverifiable',
			message: 'Could not reach Google Gemini to verify the API key.',
		};
	}

	if ( response.ok ) {
		return { status: 'valid' };
	}
	if ( response.status === 400 || response.status === 401 || response.status === 403 ) {
		return {
			status: 'invalid',
			message: 'Google Gemini rejected this API key. Check the key and try again.',
		};
	}
	return {
		status: 'unverifiable',
		message: 'Could not verify the API key with Google Gemini.',
	};
}
