/**
 * Hooks on other agents' file tools, for agents that run Studio's tools over
 * MCP and write files with their own, such as Claude Code and Codex with the
 * WordPress Studio plugin. They fire the same file triggers as Studio Code's
 * Write and Edit (site-notes.ts), and report the block validation Studio Code
 * runs before the markup reaches the site.
 *
 * The input and output are the hook JSON both agents use: tool_input names
 * the file (file_path) or carries a patch (apply_patch), and
 * hookSpecificOutput denies the call or adds context to its result.
 *
 * On a shell call they also report the content the call changed in the sites'
 * databases (post-content-check.ts): each hook is its own process, so the
 * snapshot PreToolUse takes is kept in a file for its PostToolUse.
 */
import { createHash } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { BlockValidationGate } from 'cli/ai/block-validation-gate';
import { PostContentCheck, type PostSnapshot } from 'cli/ai/post-content-check';
import { createSiteNotes } from 'cli/ai/site-notes';

export interface HookInput {
	hook_event_name?: string;
	tool_name?: string;
	tool_input?: Record< string, unknown >;
	cwd?: string;
	session_id?: string;
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

function snapshotFile( sessionId: string ): string {
	const key = createHash( 'sha1' ).update( sessionId ).digest( 'hex' ).slice( 0, 16 );
	return path.join( os.tmpdir(), `studio-hook-post-content-${ key }.json` );
}

// The session's post content check, with the snapshots its last hook kept.
async function withPostContent< T >(
	sessionId: string | undefined,
	run: ( check: PostContentCheck ) => Promise< T >
): Promise< T | undefined > {
	if ( ! sessionId ) {
		return undefined;
	}
	const file = snapshotFile( sessionId );
	const kept: Record< string, PostSnapshot > = await readFile( file, 'utf8' )
		.then( ( text ) => JSON.parse( text ) )
		.catch( () => ( {} ) );
	const snapshots = new Map( Object.entries( kept ) );
	const result = await run( new PostContentCheck( snapshots ) );
	await writeFile( file, JSON.stringify( Object.fromEntries( snapshots ) ), 'utf8' );
	return result;
}

export async function runFileToolHook(
	input: HookInput,
	gate = new BlockValidationGate()
): Promise< HookOutput | undefined > {
	const files = getWrittenFiles( input );
	const siteNotes = createSiteNotes( { gate } );
	if ( input.hook_event_name === 'PreToolUse' ) {
		await withPostContent( input.session_id, ( check ) => check.snapshot() ).catch(
			() => undefined
		);
		for ( const file of files ) {
			const reason = await siteNotes.beforeWrite( file );
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
		notes.push( ...( await siteNotes.afterWrite( file ) ) );
	}
	const { summaries, problems } = await gate.settle();
	const changedContent = ( await withPostContent( input.session_id, ( check ) =>
		check.settle()
	).catch( () => undefined ) ) ?? { summaries: [], problems: [] };
	const context = [
		...[ ...summaries, ...changedContent.summaries ].map(
			( line ) => `Block validation: ${ line }`
		),
		...problems,
		...changedContent.problems,
		...notes,
	].join( '\n' );
	return context
		? { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context } }
		: undefined;
}
