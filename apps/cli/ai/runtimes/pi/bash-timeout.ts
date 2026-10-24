/**
 * A default timeout for shell commands. Pi's bash tool runs a command for as
 * long as it takes unless the call sets a timeout, so a command that never
 * ends, such as a search of the whole disk, holds the turn. Studio gives each
 * command the default Claude Code's Bash tool has, two minutes; a call that
 * needs longer sets its own.
 */
import { Type, type TSchema } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';

const DEFAULT_TIMEOUT_SECONDS = 120;

export function withDefaultTimeout< S extends TSchema >(
	tool: AgentTool< S >,
	seconds = DEFAULT_TIMEOUT_SECONDS
): AgentTool< S > {
	const schema = tool.parameters as S & { properties: Record< string, TSchema > };
	// A spread keeps TypeBox's symbol keys, which structuredClone drops.
	const parameters = {
		...schema,
		properties: {
			...schema.properties,
			timeout: Type.Optional(
				Type.Number( {
					description: `Timeout in seconds (default ${ seconds }); a command that needs longer, such as a large install, sets its own`,
				} )
			),
		},
	};
	return {
		...tool,
		parameters,
		execute: ( id, args, ...rest ) =>
			tool.execute( id, { ...args, timeout: args.timeout ?? seconds }, ...rest ),
	};
}
