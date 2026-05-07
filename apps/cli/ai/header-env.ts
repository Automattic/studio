// Header env-var parsers shared by the agent runtime and one-shot AI calls.
// Two formats live in `apps/cli/ai/providers.ts` — `ANTHROPIC_CUSTOM_HEADERS`
// is `Name: Value\nName: Value` (built by `buildAnthropicCustomHeaders`) and
// `STUDIO_OPENAI_DEFAULT_HEADERS` is `JSON.stringify`'d. Anything that needs
// to read these env vars should import from here so the line vs JSON contract
// stays in one place.

export function parseAnthropicHeaderEnv(
	value: string | undefined
): Record< string, string > | undefined {
	if ( ! value ) {
		return undefined;
	}
	const out: Record< string, string > = {};
	for ( const line of value.split( '\n' ) ) {
		const idx = line.indexOf( ':' );
		if ( idx <= 0 ) {
			continue;
		}
		const name = line.slice( 0, idx ).trim();
		const v = line.slice( idx + 1 ).trim();
		if ( name && v ) {
			out[ name ] = v;
		}
	}
	return Object.keys( out ).length ? out : undefined;
}

export function parseJsonHeaderEnv(
	value: string | undefined
): Record< string, string > | undefined {
	if ( ! value ) {
		return undefined;
	}
	try {
		const parsed: unknown = JSON.parse( value );
		if ( parsed && typeof parsed === 'object' && ! Array.isArray( parsed ) ) {
			const entries = Object.entries( parsed as Record< string, unknown > ).filter(
				( [ , v ] ) => typeof v === 'string'
			) as [ string, string ][];
			return entries.length ? Object.fromEntries( entries ) : undefined;
		}
		console.warn(
			'STUDIO_OPENAI_DEFAULT_HEADERS must be a JSON object of string→string pairs; ignoring custom headers.'
		);
	} catch {
		console.warn(
			'STUDIO_OPENAI_DEFAULT_HEADERS contained malformed JSON; ignoring custom headers.'
		);
	}
	return undefined;
}
