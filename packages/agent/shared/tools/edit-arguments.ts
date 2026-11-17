import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { TSchema } from 'typebox';

// JSON text with the control characters inside its strings escaped. Models
// that send Edit's `edits` as a JSON string sometimes leave a file's tabs in
// it raw, which JSON.parse rejects, so pi's own repair of string `edits`
// (prepareEditArguments) leaves the call to fail validation.
export function escapeControlCharactersInStrings( json: string ): string {
	let inString = false;
	let escaped = false;
	let out = '';
	for ( const char of json ) {
		if ( inString && ! escaped && char < ' ' ) {
			out += JSON.stringify( char ).slice( 1, -1 );
			continue;
		}
		if ( escaped ) {
			escaped = false;
		} else if ( char === '\\' ) {
			escaped = inString;
		} else if ( char === '"' ) {
			inString = ! inString;
		}
		out += char;
	}
	return out;
}

// pi's Edit tool, also taking `edits` as a JSON string with raw tabs or
// newlines in its texts.
export function withStringEdits< S extends TSchema >( tool: AgentTool< S > ): AgentTool< S > {
	const prepare = tool.prepareArguments;
	return {
		...tool,
		prepareArguments: ( args ) => {
			if ( args && typeof args === 'object' ) {
				const { edits } = args as { edits?: unknown };
				if ( typeof edits === 'string' ) {
					try {
						JSON.parse( edits );
					} catch {
						args = { ...args, edits: escapeControlCharactersInStrings( edits ) };
					}
				}
			}
			return prepare ? prepare( args ) : ( args as never );
		},
	};
}
