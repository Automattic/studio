// Windows caps a process's whole environment block at 32767 characters, and CreateProcess kills the
// child with STATUS_STACK_BUFFER_OVERRUN (0xC0000409) when it overflows — before the program runs a
// single instruction, so there is no stderr and no error log to explain it. A single huge inherited
// variable is enough: CI sets BUILDKITE_MESSAGE to the full commit message, and a dependabot
// changelog of ~31KB pushed a 43917-byte block past the cap, breaking every site start on Windows
// with a misleading "PHP error during startup". Nothing a child needs is anywhere near this large,
// so drop oversized values rather than hand a child a block it cannot spawn with.
const MAX_INHERITED_ENV_VALUE_CHARS = 8 * 1024;

export function withoutOversizedEnvValues( env: NodeJS.ProcessEnv ): NodeJS.ProcessEnv {
	const trimmed: NodeJS.ProcessEnv = {};
	for ( const [ name, value ] of Object.entries( env ) ) {
		if ( typeof value === 'string' && value.length > MAX_INHERITED_ENV_VALUE_CHARS ) {
			continue;
		}
		trimmed[ name ] = value;
	}
	return trimmed;
}
