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
 * databases (post-content-check.ts). When the agent stops, the Stop hook
 * continues its turn with the problems still open (open-problems.ts). Each
 * hook is its own process, so the session's snapshots and open problems are
 * kept in a file between hooks.
 */
import { createHash } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { BlockValidationGate } from 'cli/ai/block-validation-gate';
import { describeOpenProblems, OpenProblems, type OpenProblemsState } from 'cli/ai/open-problems';
import { PostContentCheck, type PostSnapshot } from 'cli/ai/post-content-check';
import { createSiteNotes } from 'cli/ai/site-notes';
import { studioMessage, validationLines } from 'cli/ai/studio-message';

export interface HookInput {
	hook_event_name?: string;
	tool_name?: string;
	tool_input?: Record< string, unknown >;
	cwd?: string;
	session_id?: string;
}

// A tool hook's output, or a Stop hook's decision to continue the turn.
interface HookOutput {
	hookSpecificOutput?:
		| {
				hookEventName: 'PreToolUse';
				permissionDecision: 'deny';
				permissionDecisionReason: string;
		  }
		| { hookEventName: 'PostToolUse'; additionalContext: string };
	decision?: 'block';
	reason?: string;
}

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

interface SessionState {
	snapshots: Record< string, PostSnapshot >;
	open?: OpenProblemsState;
}

function stateFile( sessionId: string ): string {
	const key = createHash( 'sha1' ).update( sessionId ).digest( 'hex' ).slice( 0, 16 );
	return path.join( os.tmpdir(), `studio-hook-session-${ key }.json` );
}

// The session's checks, with the state its last hook kept; without a session,
// a call's own.
async function withSession< T >(
	sessionId: string | undefined,
	run: ( checks: { postContent: PostContentCheck; open: OpenProblems } ) => Promise< T >
): Promise< T > {
	const file = sessionId ? stateFile( sessionId ) : undefined;
	const kept: Partial< SessionState > = file
		? await readFile( file, 'utf8' )
				.then( ( text ) => JSON.parse( text ) )
				.catch( () => ( {} ) )
		: {};
	const snapshots = new Map( Object.entries( kept.snapshots ?? {} ) );
	const open = new OpenProblems( kept.open );
	const result = await run( { postContent: new PostContentCheck( snapshots, open ), open } );
	if ( file ) {
		const state: SessionState = { snapshots: Object.fromEntries( snapshots ), open: open.toJSON() };
		await writeFile( file, JSON.stringify( state ), 'utf8' );
	}
	return result;
}

export async function runFileToolHook(
	input: HookInput,
	makeGate = ( open?: OpenProblems ) => new BlockValidationGate( undefined, open )
): Promise< HookOutput | undefined > {
	if ( input.hook_event_name === 'Stop' ) {
		const problems = await withSession( input.session_id, ( { open } ) => open.raise() ).catch(
			() => []
		);
		return problems.length
			? { decision: 'block', reason: describeOpenProblems( problems ) }
			: undefined;
	}
	const files = getWrittenFiles( input );
	if ( input.hook_event_name === 'PreToolUse' ) {
		const siteNotes = createSiteNotes( { gate: makeGate() } );
		await withSession( input.session_id, ( { postContent } ) => postContent.snapshot() ).catch(
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
	const checked = await withSession( input.session_id, async ( { postContent, open } ) => {
		const gate = makeGate( open );
		const siteNotes = createSiteNotes( { gate } );
		const notes: string[] = [];
		for ( const file of files ) {
			notes.push( ...( await siteNotes.afterWrite( file ) ) );
		}
		return { notes, files: await gate.settle(), content: await postContent.settle() };
	} ).catch( () => undefined );
	const context =
		checked &&
		studioMessage( 'notes', [
			...validationLines( checked.files ),
			...validationLines( checked.content ),
			...checked.notes,
		] );
	return context
		? { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context } }
		: undefined;
}
