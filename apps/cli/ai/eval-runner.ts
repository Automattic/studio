/**
 * PromptFoo eval runner for Studio Code agent.
 *
 * Hooks into runStudioAgentTurn() to capture tool calls, tool results, and
 * assistant text. Returns raw structured data — assertions live in the
 * promptfoo config, not here.
 */

import { mkdirSync, writeFileSync, writeSync as fsWriteSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import {
	readGlobalInstructionsFile,
	writeGlobalInstructions,
} from '@studio/common/ai/global-instructions';
import { DEFAULT_MODEL, isAiModelId, type AiModelId } from '@studio/common/ai/models';
import { findLastAssistant } from '@studio/common/ai/session-events';
import {
	addConnectedWpcomSite,
	removeConnectedWpcomSite,
} from '@studio/common/lib/connected-sites';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { getGlobalInstructionsPath } from '@studio/common/lib/well-known-paths';
import { snapshotSchema } from '@studio/common/types/snapshot';
import { syncSiteSchema, type SyncSite } from '@studio/common/types/sync';
import { z } from 'zod';
import {
	resolveAiEnvironment,
	resolveInitialAiProvider,
	resolveUnavailableAiProvider,
} from 'cli/ai/auth';
import { runStudioAgentTurn } from 'cli/ai/runtimes/pi';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	unlockCliConfig,
} from 'cli/lib/cli-config/core';
import { deleteSnapshotFromConfig } from 'cli/lib/cli-config/snapshots';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { AiProviderId } from 'cli/ai/providers';

// Optional fixtures a test can pre-seed before the agent turn, so flows that
// depend on connected remote sites and/or preview sites can be exercised
// deterministically and offline (no real WordPress.com connection/preview).
const evalSeedSchema = z.object( {
	localSite: z
		.object( {
			id: z.string(),
			name: z.string(),
			path: z.string(),
			port: z.number().default( 8881 ),
			url: z.string().optional(),
			phpVersion: z.string().default( '8.2' ),
		} )
		.optional(),
	connectedWpcomSites: z.array( syncSiteSchema ).optional(),
	snapshots: z.array( snapshotSchema ).optional(),
	globalInstructions: z.string().optional(),
} );
type EvalSeed = z.infer< typeof evalSeedSchema >;

interface EvalRunnerInput {
	prompt: string;
	timeoutMs?: number;
	model?: AiModelId;
	seed?: EvalSeed;
}

/**
 * Writes the requested fixtures into cli.json (local site + snapshots) and
 * shared.json (connected WordPress.com sites). Returns a cleanup function that
 * removes exactly what was added, so reruns start from a clean slate.
 * `globalInstructions` is the exception: it overwrites the user's real
 * instructions file, so cleanup restores the prior content instead.
 */
async function seedFixtures( seed: EvalSeed ): Promise< () => Promise< void > > {
	const { localSite, connectedWpcomSites = [], snapshots = [], globalInstructions } = seed;

	let restoreInstructions: ( () => Promise< void > ) | null = null;
	if ( typeof globalInstructions === 'string' ) {
		const prior = await readGlobalInstructionsFile();
		restoreInstructions =
			prior === null
				? () => rm( getGlobalInstructionsPath(), { force: true } )
				: () => writeGlobalInstructions( prior );
		await writeGlobalInstructions( globalInstructions );
	}

	// preview_list scopes snapshots to the authenticated user (getSnapshotsFromConfig
	// filters on snapshot.userId), so a seeded snapshot is invisible unless it carries
	// the current user's id. Fixtures omit it — they can't know the id — so stamp it here.
	const authUserId = ( await readAuthToken() )?.id;

	if ( localSite || snapshots.length > 0 ) {
		try {
			await lockCliConfig();
			const config = await readCliConfig();
			if ( localSite && ! config.sites.some( ( s ) => s.id === localSite.id ) ) {
				config.sites.push( {
					id: localSite.id,
					name: localSite.name,
					path: localSite.path,
					port: localSite.port,
					url: localSite.url ?? `http://localhost:${ localSite.port }`,
					phpVersion: localSite.phpVersion,
				} );
			}
			for ( const snapshot of snapshots ) {
				config.snapshots.push(
					snapshot.userId === undefined && authUserId !== undefined
						? { ...snapshot, userId: authUserId }
						: snapshot
				);
			}
			await saveCliConfig( config );
		} finally {
			await unlockCliConfig();
		}
	}

	const seededConnections: SyncSite[] = [];
	for ( const site of connectedWpcomSites ) {
		await addConnectedWpcomSite( site.localSiteId, site );
		seededConnections.push( site );
	}

	return async () => {
		await restoreInstructions?.().catch( () => undefined );
		for ( const site of seededConnections ) {
			await removeConnectedWpcomSite( site.localSiteId, site.id ).catch( () => undefined );
		}
		for ( const snapshot of snapshots ) {
			await deleteSnapshotFromConfig( snapshot.url ).catch( () => undefined );
		}
		if ( localSite ) {
			try {
				await lockCliConfig();
				const config = await readCliConfig();
				config.sites = config.sites.filter( ( s ) => s.id !== localSite.id );
				await saveCliConfig( config );
			} catch {
				// best-effort cleanup
			} finally {
				await unlockCliConfig();
			}
		}
	};
}

function extractToolCalls( event: AgentSessionEvent ) {
	if ( event.type !== 'message_end' || event.message.role !== 'assistant' ) {
		return [];
	}
	return event.message.content
		.filter(
			(
				block
			): block is Extract< ( typeof event.message.content )[ number ], { type: 'toolCall' } > =>
				block.type === 'toolCall'
		)
		.map( ( block ) => ( {
			id: block.id,
			name: block.name,
			input: block.arguments as Record< string, unknown >,
		} ) );
}

type ToolCallRecord = {
	id: string;
	name: string;
	input: unknown;
};

type ToolEvent = {
	toolUseId: string;
	toolName: string;
	input: unknown;
	startedAtMs: number;
	endedAtMs?: number;
	durationMs?: number;
	isError?: boolean;
	turnIndex: number;
};

type FirstToolError = {
	toolUseId: string | null;
	toolName: string | null;
	input?: unknown;
	error: string;
	turnIndex: number;
};

function extractTextSegments( event: AgentSessionEvent ): string[] {
	if ( event.type !== 'message_end' || event.message.role !== 'assistant' ) {
		return [];
	}
	return event.message.content
		.filter( ( block ): block is { type: 'text'; text: string } => block.type === 'text' )
		.map( ( block ) => block.text );
}

function extractToolResult( event: AgentSessionEvent ): {
	toolUseId: string;
	isError: boolean;
	text?: string;
	images?: Array< { mimeType: string; data: string } >;
	details?: unknown;
} | null {
	if ( event.type !== 'tool_execution_end' ) {
		return null;
	}
	const result = event.result as
		| {
				content?: Array< { type: string; text?: string; data?: string; mimeType?: string } >;
				details?: unknown;
		  }
		| undefined;
	let text: string | undefined;
	let images: Array< { mimeType: string; data: string } > | undefined;
	if ( result?.content && Array.isArray( result.content ) ) {
		const textBlock = result.content.find(
			( b ): b is { type: 'text'; text: string } => b.type === 'text' && typeof b.text === 'string'
		);
		if ( textBlock ) text = textBlock.text;
		const imageBlocks = result.content.filter(
			( b ): b is { type: 'image'; data: string; mimeType?: string } =>
				b.type === 'image' && typeof b.data === 'string'
		);
		if ( imageBlocks.length > 0 ) {
			images = imageBlocks.map( ( b ) => ( { mimeType: b.mimeType ?? '', data: b.data } ) );
		}
	}
	return {
		toolUseId: event.toolCallId,
		isError: event.isError,
		text,
		images,
		details: result?.details,
	};
}

function readInput(): EvalRunnerInput {
	const prompt = process.argv[ 2 ];
	if ( ! prompt ) {
		throw new Error( 'Missing prompt argument' );
	}

	let vars: Record< string, unknown > = {};
	if ( process.argv[ 4 ] ) {
		try {
			vars = JSON.parse( process.argv[ 4 ] )?.vars ?? {};
		} catch {
			// ignore
		}
	}

	const envModel = process.env.STUDIO_EVAL_MODEL?.trim();
	const varModel = typeof vars.model === 'string' ? vars.model.trim() : undefined;
	const rawModel = varModel || envModel;
	const model = rawModel && isAiModelId( rawModel ) ? rawModel : undefined;

	let seed: EvalSeed | undefined;
	if ( vars.seed ) {
		seed = evalSeedSchema.parse( vars.seed );
	}

	return {
		prompt: ( vars.prompt as string ) ?? prompt,
		timeoutMs: typeof vars.timeoutMs === 'number' ? vars.timeoutMs : undefined,
		model,
		seed,
	};
}

async function runEval( input: EvalRunnerInput ) {
	// Mirrors the fallback in runStudioAgentTurn (ai/runtimes/pi/index.ts) — keep in sync.
	const resolvedModel = input.model ?? DEFAULT_MODEL;
	const evalStartedAt = Date.now();
	const elapsed = () => Date.now() - evalStartedAt;
	const phaseTimingsMs: Record< string, number > = {};
	let phaseStartedAt = Date.now();

	let aiProvider: AiProviderId = await resolveInitialAiProvider();
	phaseTimingsMs.resolve_initial_provider_ms = Date.now() - phaseStartedAt;

	phaseStartedAt = Date.now();
	aiProvider = ( await resolveUnavailableAiProvider( aiProvider ) ) ?? aiProvider;
	phaseTimingsMs.resolve_unavailable_provider_ms = Date.now() - phaseStartedAt;

	phaseStartedAt = Date.now();
	const aiEnvironment = await resolveAiEnvironment( aiProvider );
	phaseTimingsMs.resolve_ai_environment_ms = Date.now() - phaseStartedAt;

	const env = {
		...( process.env as Record< string, string > ),
		...aiEnvironment,
	};
	// Allow running inside a Claude Code session
	delete env.CLAUDECODE;

	const toolCalls: ToolCallRecord[] = [];
	const toolResults: {
		toolUseId: string | null;
		toolName: string | null;
		isError: boolean;
		text?: string;
		images?: Array< { mimeType: string; data: string } >;
		details?: unknown;
	}[] = [];
	const toolEvents: ToolEvent[] = [];
	const textSegments: string[] = [];
	const toolNameById = new Map< string, string >();
	const toolEventById = new Map< string, ToolEvent >();
	let firstToolError: FirstToolError | null = null;
	// Wall-clock per turn, measured between successive assistant messages.
	const turnDurationsMs: number[] = [];
	let turnIndex = 0;
	let numTurns = 0;
	let numTurnsResult: number | null = null;
	let success = false;
	let error: string | null = null;
	let timedOut = false;

	let cleanupSeed: ( () => Promise< void > ) | null = null;
	if ( input.seed ) {
		cleanupSeed = await seedFixtures( input.seed );
	}

	phaseStartedAt = Date.now();
	const sessionDirEnv = process.env.STUDIO_EVAL_SESSION_DIR?.trim();
	let session: SessionManager;
	if ( sessionDirEnv ) {
		mkdirSync( sessionDirEnv, { recursive: true } );
		session = SessionManager.create( STUDIO_SITES_ROOT, sessionDirEnv );
	} else {
		session = SessionManager.inMemory( STUDIO_SITES_ROOT );
	}
	const queryStartedAt = Date.now();
	let turnStart = queryStartedAt;

	const handleEvent = ( event: AgentSessionEvent ): void => {
		if ( event.type === 'message_end' && event.message.role === 'assistant' ) {
			const now = Date.now();
			turnDurationsMs.push( now - turnStart );
			turnIndex += 1;
			if ( turnIndex === 1 ) {
				phaseTimingsMs.first_assistant_message_ms = now - queryStartedAt;
			}
			turnStart = now;
		}
		for ( const tc of extractToolCalls( event ) ) {
			toolCalls.push( tc );
			toolNameById.set( tc.id, tc.name );
			const evt: ToolEvent = {
				toolUseId: tc.id,
				toolName: tc.name,
				input: tc.input,
				startedAtMs: elapsed(),
				turnIndex,
			};
			toolEvents.push( evt );
			toolEventById.set( tc.id, evt );
		}
		textSegments.push( ...extractTextSegments( event ) );

		if ( event.type === 'tool_execution_end' ) {
			const tr = extractToolResult( event );
			if ( tr ) {
				const id = tr.toolUseId;
				const evt = toolEventById.get( id );
				if ( evt ) {
					evt.endedAtMs = elapsed();
					evt.durationMs = evt.endedAtMs - evt.startedAtMs;
					evt.isError = tr.isError;
				}
				if ( tr.isError && ! firstToolError ) {
					firstToolError = {
						toolUseId: id,
						toolName: toolNameById.get( id ) ?? null,
						...( evt?.input ? { input: evt.input } : {} ),
						error: tr.text ?? 'Tool returned an error result.',
						turnIndex,
					};
				}
				toolResults.push( {
					toolUseId: id,
					toolName: toolNameById.get( id ) ?? null,
					isError: tr.isError,
					...( tr.text ? { text: tr.text } : {} ),
					...( tr.images ? { images: tr.images } : {} ),
					...( tr.details !== undefined ? { details: tr.details } : {} ),
				} );
			}
		}

		if ( event.type === 'turn_end' ) {
			numTurns += 1;
		}

		if ( event.type === 'agent_end' ) {
			const lastAssistant = findLastAssistant( event.messages );
			success =
				! lastAssistant ||
				( lastAssistant.stopReason !== 'error' && lastAssistant.stopReason !== 'aborted' );
			numTurnsResult = numTurns;
		}
	};

	const query = runStudioAgentTurn( {
		prompt: input.prompt.trim(),
		env,
		session,
		onEvent: handleEvent,
		...( input.model ? { model: input.model } : {} ),
	} );
	phaseTimingsMs.start_ai_agent_ms = Date.now() - phaseStartedAt;

	const timeout = setTimeout( () => {
		timedOut = true;
		void query.interrupt();
	}, input.timeoutMs ?? 300000 );

	try {
		await query.result;
	} catch ( caught ) {
		error = caught instanceof Error ? caught.message : String( caught );
	} finally {
		clearTimeout( timeout );
		if ( cleanupSeed ) {
			await cleanupSeed().catch( () => undefined );
		}
	}
	phaseTimingsMs.total_eval_ms = elapsed();

	return {
		success,
		error,
		timedOut,
		model: resolvedModel,
		numTurns: numTurnsResult,
		phaseTimingsMs,
		turnDurationsMs,
		toolCalls,
		toolResults,
		toolEvents,
		firstToolError,
		textSegments,
	};
}

const RESULT_PREFIX = 'EVAL_RUNNER_RESULT_FILE=';

// Studio tools and the Agent SDK freely print to stdout (pi-tui spinners,
// daemon status, …). promptfoo's `exec:` provider wraps us in
// `child_process.exec`, whose default 1 MB stdout buffer long runs overflow.
// Redirect stdout writes to stderr during the run, serialize the result to a
// tmp file, and emit only `EVAL_RUNNER_RESULT_FILE=<path>` via a raw
// `fs.writeSync(1, …)` that bypasses the wrapper.
async function main() {
	const filePath = path.join( os.tmpdir(), `studio-eval-${ Date.now() }-${ process.pid }.json` );

	( process.stdout as unknown as { write: ( ...args: unknown[] ) => boolean } ).write = (
		...args: unknown[]
	) => {
		return ( process.stderr.write as unknown as ( ...args: unknown[] ) => boolean )( ...args );
	};
	const rawStdout = ( line: string ) => fsWriteSync( 1, line );
	const emit = ( payload: unknown ) => {
		try {
			writeFileSync( filePath, JSON.stringify( payload ) );
			rawStdout( `${ RESULT_PREFIX }${ filePath }` );
		} catch ( writeError ) {
			const msg = writeError instanceof Error ? writeError.message : String( writeError );
			process.stderr.write( `[eval-runner] failed to write ${ filePath }: ${ msg }\n` );
			rawStdout( JSON.stringify( { success: false, error: msg } ) );
		}
	};

	let exitCode = 0;
	try {
		emit( await runEval( readInput() ) );
	} catch ( error ) {
		emit( { success: false, error: error instanceof Error ? error.message : String( error ) } );
		exitCode = 1;
	}
	// The Agent SDK keeps internal handles open past conversation end; bail out
	// rather than leaving promptfoo waiting on its exec child.
	process.exit( exitCode );
}

void main();
