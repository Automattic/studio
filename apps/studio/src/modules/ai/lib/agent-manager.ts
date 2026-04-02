import crypto from 'crypto';
import os from 'os';
import path from 'path';
import { query, type Query, type PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { buildSystemPrompt as buildCliSystemPrompt } from '@studio/common/ai/system-prompt';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { SiteServer } from 'src/site-server';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';
import { serializeSDKMessage } from './message-serializer';
import { resolveAgentEnv } from './provider-resolver';
import { createDesktopStudioTools } from './tools';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_TURNS = 50;

// Resolve the path to the SDK's bundled cli.js.
// After Vite bundles the main process, relative paths inside the SDK break,
// so we need to point it to the real location in node_modules.
function resolveClaudeCodeExecutable(): string {
	// require.resolve works in Electron main process and survives bundling
	try {
		const sdkEntry = require.resolve( '@anthropic-ai/claude-agent-sdk' );
		return path.join( path.dirname( sdkEntry ), 'cli.js' );
	} catch {
		// Fallback: resolve from process.cwd() (the project root at dev time)
		return path.resolve(
			process.cwd(),
			'node_modules',
			'@anthropic-ai',
			'claude-agent-sdk',
			'cli.js'
		);
	}
}

const CLAUDE_CODE_EXECUTABLE = resolveClaudeCodeExecutable();

// Studio sites root — same as CLI's STUDIO_SITES_ROOT
const STUDIO_SITES_ROOT = path.join( os.homedir(), 'Studio' );
const STUDIO_ROOT = path.resolve( STUDIO_SITES_ROOT );

// Tools allowed without permission
const ALLOWED_TOOLS = [
	'mcp__studio__*',
	'Read',
	'Glob',
	'Grep',
	'WebFetch',
	'WebSearch',
	'TodoRead',
	'NotebookRead',
	'AskUserQuestion',
] as const;

// Tools that require permission for paths outside trusted roots
const PATH_GATED_TOOLS = [ 'Write', 'Edit', 'Bash', 'NotebookEdit' ];
const PATH_INPUT_KEYS = [ 'path', 'file_path', 'filePath' ];

const TRUSTED_ROOTS = [
	STUDIO_ROOT,
	path.resolve( os.tmpdir() ),
	...( os.tmpdir() !== '/tmp' ? [ '/tmp' ] : [] ),
];

function isPathWithinTrustedRoots( filePath: string ): boolean {
	const resolved = path.isAbsolute( filePath )
		? path.resolve( filePath )
		: path.resolve( STUDIO_ROOT, filePath );

	return TRUSTED_ROOTS.some(
		( root ) => resolved === root || resolved.startsWith( `${ root }${ path.sep }` )
	);
}

function getToolPaths( input: Record< string, unknown > ): string[] {
	return PATH_INPUT_KEYS.map( ( key ) => input[ key ] ).filter(
		( v ): v is string => typeof v === 'string' && v.trim().length > 0
	);
}

interface ActiveTask {
	query: Query;
	sessionId?: string;
	approvedPaths: Map< string, Set< string > >;
}

const activeTasks = new Map< string, ActiveTask >();

// Pending permission requests — keyed by requestId
const pendingPermissions = new Map<
	string,
	{
		resolve: ( result: PermissionResult ) => void;
		toolName: string;
	}
>();

function buildSystemPrompt( sitePath?: string, siteName?: string ): string {
	// Use the full CLI system prompt (workflow, design guidelines, block rules, etc.)
	const cliPrompt = buildCliSystemPrompt();

	// Add desktop-specific context
	const desktopContext = sitePath
		? `\n\n## Current Site Context\n\nThe user is working on "${
				siteName ?? 'their site'
		  }" located at: ${ sitePath }\nYour working directory is set to this site's root. Work within wp-content/.\n\nBefore making changes to content, use wp_cli to check existing content and revisions. When editing posts or pages, prefer wp_cli (wp post update) over direct file manipulation for content changes.\n`
		: '';

	return cliPrompt + desktopContext;
}

/**
 * Start a new agent session for a task.
 */
export async function startTaskAgent(
	taskId: string,
	prompt: string,
	resumeSessionId?: string
): Promise< void > {
	// Clean up any existing agent for this task
	const existing = activeTasks.get( taskId );
	if ( existing ) {
		try {
			existing.query.close();
		} catch {
			// ignore
		}
		activeTasks.delete( taskId );
	}

	const { env } = await resolveAgentEnv();

	// Look up the task's site to get its path for cwd and system prompt context
	const userData = await loadUserData();
	const taskMeta = ( userData.tasks ?? [] ).find( ( t ) => t.id === taskId );
	const siteServer = taskMeta ? SiteServer.get( taskMeta.siteId ) : undefined;
	const sitePath = siteServer?.details.path;
	const agentCwd = sitePath ?? STUDIO_ROOT;

	const agentQuery = query( {
		prompt,
		options: {
			env,
			systemPrompt: {
				type: 'preset',
				preset: 'claude_code',
				append: buildSystemPrompt( sitePath, siteServer?.details.name ),
			},
			mcpServers: {
				studio: createDesktopStudioTools(),
			},
			maxTurns: MAX_TURNS,
			cwd: agentCwd,
			tools: { type: 'preset', preset: 'claude_code' },
			allowedTools: [ ...ALLOWED_TOOLS ],
			permissionMode: 'default',
			canUseTool: async ( toolName, input, metadata ) => {
				// Check if this is a path-gated tool accessing outside trusted roots
				if ( PATH_GATED_TOOLS.includes( toolName ) ) {
					const paths = getToolPaths( input );
					const blockedPath = metadata?.blockedPath;
					const outsidePath =
						( blockedPath && ! isPathWithinTrustedRoots( blockedPath ) && blockedPath ) ||
						paths.find( ( p ) => ! isPathWithinTrustedRoots( p ) );

					if ( outsidePath ) {
						const task = activeTasks.get( taskId );
						// Check session-level approval
						if ( task?.approvedPaths.get( toolName )?.has( path.resolve( outsidePath ) ) ) {
							const result: PermissionResult = {
								behavior: 'allow',
								updatedInput: input,
							};
							if ( metadata?.suggestions?.length ) {
								result.updatedPermissions = metadata.suggestions;
							}
							return result;
						}

						// Ask the renderer for permission
						const requestId = crypto.randomUUID();
						const permissionPromise = new Promise< PermissionResult >( ( resolve ) => {
							pendingPermissions.set( requestId, { resolve, toolName } );
						} );

						await sendIpcEventToRenderer( 'task-permission-request', {
							requestId,
							taskId,
							toolName,
							input,
							description: `Allow ${ toolName } to access ${ outsidePath }?`,
						} );

						return permissionPromise;
					}
				}

				return { behavior: 'allow' as const, updatedInput: input } as PermissionResult;
			},
			pathToClaudeCodeExecutable: CLAUDE_CODE_EXECUTABLE,
			model: DEFAULT_MODEL,
			...( resumeSessionId && { resume: resumeSessionId } ),
		},
	} );

	const activeTask: ActiveTask = {
		query: agentQuery,
		approvedPaths: new Map(),
	};
	activeTasks.set( taskId, activeTask );

	// Update task status to in-progress
	await sendIpcEventToRenderer( 'task-status-changed', { taskId, status: 'in-progress' } );

	// Run the message loop in the background
	void runMessageLoop( taskId, agentQuery );
}

async function runMessageLoop( taskId: string, agentQuery: Query ): Promise< void > {
	try {
		for await ( const message of agentQuery ) {
			const taskMessages = serializeSDKMessage( message );

			// Capture session ID from result messages
			if ( message.session_id ) {
				const task = activeTasks.get( taskId );
				if ( task && ! task.sessionId ) {
					task.sessionId = message.session_id;
					// Persist session ID for resume
					void persistSessionId( taskId, message.session_id );
				}
			}

			// Forward each serialized message to the renderer
			for ( const msg of taskMessages ) {
				await sendIpcEventToRenderer( 'task-message', { taskId, message: msg } );
			}
		}
	} catch ( error ) {
		const errorMessage = error instanceof Error ? error.message : String( error );
		await sendIpcEventToRenderer( 'task-error', { taskId, error: errorMessage } );
	} finally {
		activeTasks.delete( taskId );
		await sendIpcEventToRenderer( 'task-status-changed', { taskId, status: 'waiting' } );
	}
}

async function persistSessionId( taskId: string, sessionId: string ): Promise< void > {
	try {
		await lockAppdata();
		const userData = await loadUserData();
		const tasks = userData.tasks ?? [];
		const index = tasks.findIndex( ( t ) => t.id === taskId );
		if ( index !== -1 ) {
			tasks[ index ] = { ...tasks[ index ], sessionId, updatedAt: Date.now() };
			await saveUserData( { ...userData, tasks } );
		}
	} finally {
		await unlockAppdata();
	}
}

/**
 * Send a follow-up message to an active task agent.
 * If no agent is active, starts a new one.
 */
export async function sendTaskMessage( taskId: string, message: string ): Promise< void > {
	const active = activeTasks.get( taskId );

	if ( active ) {
		// Use streamInput to send follow-up message
		const sdkMessage = {
			type: 'user' as const,
			message: { role: 'user' as const, content: message },
			parent_tool_use_id: null,
			session_id: active.sessionId ?? '',
		};
		await active.query.streamInput(
			( async function* () {
				yield sdkMessage;
			} )()
		);
	} else {
		// Look up the task to get its session ID for resuming
		const userData = await loadUserData();
		const task = ( userData.tasks ?? [] ).find( ( t ) => t.id === taskId );
		await startTaskAgent( taskId, message, task?.sessionId );
	}
}

/**
 * Interrupt an active task agent.
 */
export function interruptTask( taskId: string ): void {
	const active = activeTasks.get( taskId );
	if ( active ) {
		void active.query.interrupt();
	}
}

/**
 * Respond to a pending permission request from the renderer.
 */
export function respondToPermissionRequest(
	requestId: string,
	response: 'allow_once' | 'allow_session' | 'deny',
	taskId?: string
): void {
	const pending = pendingPermissions.get( requestId );
	if ( ! pending ) {
		return;
	}
	pendingPermissions.delete( requestId );

	if ( response === 'deny' ) {
		pending.resolve( { behavior: 'deny', message: 'Access denied by user' } );
		return;
	}

	// For allow_session, remember the approval
	if ( response === 'allow_session' && taskId ) {
		const task = activeTasks.get( taskId );
		if ( task ) {
			const approved = task.approvedPaths.get( pending.toolName ) ?? new Set();
			task.approvedPaths.set( pending.toolName, approved );
		}
	}

	pending.resolve( { behavior: 'allow' } );
}

/**
 * Cleanup all active agents (called on app quit).
 */
export function cleanupAllAgents(): void {
	for ( const [ , task ] of activeTasks ) {
		try {
			task.query.close();
		} catch {
			// ignore
		}
	}
	activeTasks.clear();
}
