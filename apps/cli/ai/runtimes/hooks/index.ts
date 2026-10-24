/**
 * Hooks on other agents' file tools, for agents that run Studio's tools over
 * MCP and write files with their own, such as Claude Code and Codex with the
 * WordPress Studio plugin. Before a write, the same refusal as Studio Code's
 * Write and Edit; after it, the same checks and notes, and the block
 * validation Studio Code runs before the markup reaches the site.
 *
 * The input and output are the hook JSON both agents use: tool_input names
 * the file (file_path) or carries a patch (apply_patch), and
 * hookSpecificOutput denies the call or adds context to its result.
 */
import path from 'path';
import { BlockValidationGate } from 'cli/ai/block-validation-gate';
import {
	afterSiteFileWrite,
	getSiteFileWriteRefusal,
	resolveSiteFile,
} from 'cli/ai/site-file-guards';

export interface HookInput {
	hook_event_name?: string;
	tool_name?: string;
	tool_input?: Record< string, unknown >;
	cwd?: string;
}

type HookOutput = {
	hookSpecificOutput:
		| {
				hookEventName: 'PreToolUse';
				permissionDecision: 'deny';
				permissionDecisionReason: string;
		  }
		| { hookEventName: 'PostToolUse'; additionalContext: string };
};

const PATCH_FILE = /^\*\*\* (?:Add File|Update File|Move to): (.+)$/gm;

/** The files a file tool call writes, as absolute paths. */
export function getWrittenFiles( { tool_input: toolInput = {}, cwd = '' }: HookInput ): string[] {
	if ( typeof toolInput.file_path === 'string' ) {
		return [ path.resolve( cwd, toolInput.file_path ) ];
	}
	const patch = [ toolInput.command, toolInput.patch, toolInput.input ].find(
		( value ): value is string => typeof value === 'string'
	);
	return [ ...( patch ?? '' ).matchAll( PATCH_FILE ) ].map( ( match ) =>
		path.resolve( cwd, match[ 1 ].trim() )
	);
}

export async function runFileToolHook(
	input: HookInput,
	gate = new BlockValidationGate()
): Promise< HookOutput | undefined > {
	const files = getWrittenFiles( input );
	if ( input.hook_event_name === 'PreToolUse' ) {
		for ( const file of files ) {
			const reason = await getSiteFileWriteRefusal( file );
			if ( reason ) {
				return {
					hookSpecificOutput: {
						hookEventName: 'PreToolUse',
						permissionDecision: 'deny',
						permissionDecisionReason: reason,
					},
				};
			}
		}
		return undefined;
	}
	if ( input.hook_event_name !== 'PostToolUse' ) {
		return undefined;
	}
	const notes: string[] = [];
	for ( const file of files ) {
		const siteFile = resolveSiteFile( file );
		if ( siteFile ) {
			gate.track( file, siteFile.siteRoot );
			notes.push( ...( await afterSiteFileWrite( siteFile ) ) );
		}
	}
	const { summaries, problems } = await gate.settle();
	const context = [
		...summaries.map( ( line ) => `Block validation: ${ line }` ),
		...problems,
		...notes.map( ( note ) => `Note: ${ note }` ),
	].join( '\n' );
	return context
		? { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context } }
		: undefined;
}
