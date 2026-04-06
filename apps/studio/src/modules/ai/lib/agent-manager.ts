import { app } from 'electron';
import { fork, type ChildProcess } from 'node:child_process';
import path from 'path';
import { SETUP_SITE_ID } from 'src/constants';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { startPreviewServer } from 'src/lib/preview-server';
import { SiteServer } from 'src/site-server';
import { getBundledNodeBinaryPath, getCliPath } from 'src/storage/paths';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';
import { serializeSDKMessage } from './message-serializer';
import type { ElementAttachment, ImageAttachment } from '../types';

interface ActiveTask {
	child: ChildProcess;
	sessionId?: string;
}

const activeTasks = new Map< string, ActiveTask >();

/**
 * Fork the CLI in headless agent mode with an IPC channel.
 */
function forkCliAgent(): ChildProcess {
	const cliPath = getCliPath();
	const child = fork( cliPath, [ 'ai', 'agent', '--avoid-telemetry' ], {
		stdio: [ 'ignore', 'pipe', 'pipe', 'ipc' ],
		execPath: getBundledNodeBinaryPath(),
		execArgv: [ '--experimental-wasm-jspi' ],
		env: { ...process.env },
	} );

	// Clean up on app quit
	const quitHandler = () => {
		child.removeAllListeners();
		child.kill();
	};
	app.on( 'will-quit', quitHandler );

	child.on( 'close', () => {
		child.removeAllListeners();
		app.off( 'will-quit', quitHandler );
	} );

	// Log CLI stdout/stderr for debugging
	child.stdout?.on( 'data', ( data: Buffer ) => {
		const text = data.toString().trimEnd();
		if ( text ) {
			console.log( `[AI Agent] ${ text }` );
		}
	} );
	child.stderr?.on( 'data', ( data: Buffer ) => {
		const text = data.toString().trimEnd();
		if ( text ) {
			console.error( `[AI Agent] ${ text }` );
		}
	} );

	return child;
}

/**
 * Start a new agent session for a task.
 */
export async function startTaskAgent(
	taskId: string,
	prompt: string,
	resumeSessionId?: string,
	images?: ImageAttachment[],
	elements?: ElementAttachment[]
): Promise< void > {
	// Clean up any existing agent for this task
	const existing = activeTasks.get( taskId );
	if ( existing ) {
		try {
			existing.child.send( { type: 'ai:kill' } );
		} catch {
			// ignore — child may have already exited
		}
		existing.child.kill();
		activeTasks.delete( taskId );
	}

	// Look up the task's site for context
	const userData = await loadUserData();
	const taskMeta = ( userData.tasks ?? [] ).find( ( t ) => t.id === taskId );
	const siteServer = taskMeta ? SiteServer.get( taskMeta.siteId ) : undefined;
	const sitePath = siteServer?.details.path;
	const siteName = siteServer?.details.name;

	const child = forkCliAgent();
	const activeTask: ActiveTask = { child };
	activeTasks.set( taskId, activeTask );

	// Update task status to in-progress
	await sendIpcEventToRenderer( 'task-status-changed', { taskId, status: 'in-progress' } );

	// Wait for the CLI to signal ready, then send the start message
	const onReady = () => {
		child.send( {
			type: 'ai:start',
			prompt,
			...( resumeSessionId && { resume: resumeSessionId } ),
			...( sitePath && { sitePath } ),
			...( siteName && { siteName } ),
			...( images?.length && { images } ),
			...( elements?.length && { elements } ),
		} );
	};

	// Handle IPC messages from the CLI child
	child.on( 'message', ( raw: unknown ) => {
		const message = raw as { type: string; [ key: string ]: unknown };

		switch ( message.type ) {
			case 'ai:ready':
				onReady();
				break;

			case 'ai:sdk-message': {
				const taskMessages = serializeSDKMessage( message.message as never );
				for ( const msg of taskMessages ) {
					void sendIpcEventToRenderer( 'task-message', { taskId, message: msg } );
				}
				break;
			}

			case 'ai:session-id': {
				const sessionId = message.sessionId as string;
				activeTask.sessionId = sessionId;
				void persistSessionId( taskId, sessionId );
				break;
			}

			case 'ai:permission-request':
				void sendIpcEventToRenderer( 'task-permission-request', {
					requestId: message.requestId as string,
					taskId,
					toolName: ( message.toolName as string ) ?? 'unknown',
					input: {},
					description: message.description as string,
				} );
				break;

			case 'ai:question-request':
				void sendIpcEventToRenderer( 'task-question-request', {
					requestId: message.requestId as string,
					taskId,
					question: message.question as string,
					options: message.options as Array< { label: string; description: string } >,
				} );
				break;

			case 'ai:browser-navigate': {
				const siteId = taskMeta?.siteId;
				let url = message.url as string;

				if ( siteId ) {
					const details = SiteServer.get( siteId )?.details;
					const siteUrl = details?.running ? details.url : undefined;
					if ( siteUrl && url.startsWith( '/' ) ) {
						url = new URL( url, siteUrl ).toString();
					}
				}

				// Serve local file paths via the preview server (CSP blocks file:// in iframes)
				if ( url.startsWith( '/' ) && ! url.startsWith( '//' ) ) {
					const filePath = url;
					const dir = path.dirname( filePath );
					const fileName = path.basename( filePath );
					startPreviewServer( dir )
						.then( ( baseUrl ) => {
							void sendIpcEventToRenderer( 'browser-navigate', {
								siteId: siteId === SETUP_SITE_ID ? taskId : siteId ?? taskId,
								url: `${ baseUrl }/${ fileName }`,
							} );
						} )
						.catch( ( err ) => {
							console.error( 'Failed to start preview server:', err );
						} );
					break;
				}

				void sendIpcEventToRenderer( 'browser-navigate', {
					siteId: siteId === SETUP_SITE_ID ? taskId : siteId ?? taskId,
					url,
				} );
				break;
			}

			case 'ai:browser-reload': {
				const siteId = taskMeta?.siteId;
				if ( siteId ) {
					void sendIpcEventToRenderer( 'browser-reload', { siteId } );
				}
				break;
			}

			case 'ai:error':
				void sendIpcEventToRenderer( 'task-error', {
					taskId,
					error: message.error as string,
				} );
				break;

			case 'ai:done':
				activeTasks.delete( taskId );
				void sendIpcEventToRenderer( 'task-status-changed', {
					taskId,
					status: 'waiting',
				} );
				break;
		}
	} );

	// Handle child process crash
	child.on( 'close', ( exitCode ) => {
		if ( activeTasks.has( taskId ) ) {
			activeTasks.delete( taskId );
			if ( exitCode !== 0 ) {
				void sendIpcEventToRenderer( 'task-error', {
					taskId,
					error: `Agent process exited unexpectedly (code ${ exitCode })`,
				} );
			}
			void sendIpcEventToRenderer( 'task-status-changed', {
				taskId,
				status: 'waiting',
			} );
		}
	} );

	child.on( 'error', ( error ) => {
		console.error( 'AI agent child process error:', error );
		if ( activeTasks.has( taskId ) ) {
			activeTasks.delete( taskId );
			void sendIpcEventToRenderer( 'task-error', {
				taskId,
				error: error.message,
			} );
			void sendIpcEventToRenderer( 'task-status-changed', {
				taskId,
				status: 'waiting',
			} );
		}
	} );
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
 * If no agent is active, starts a new one with session resume.
 */
export async function sendTaskMessage(
	taskId: string,
	message: string,
	images?: ImageAttachment[],
	elements?: ElementAttachment[]
): Promise< void > {
	const active = activeTasks.get( taskId );

	if ( active ) {
		try {
			active.child.send( {
				type: 'ai:follow-up',
				message,
				...( images?.length && { images } ),
				...( elements?.length && { elements } ),
			} );
		} catch {
			// Child may have exited — start a new one
			const userData = await loadUserData();
			const task = ( userData.tasks ?? [] ).find( ( t ) => t.id === taskId );
			await startTaskAgent( taskId, message, task?.sessionId, images, elements );
		}
	} else {
		// Look up the task to get its session ID for resuming
		const userData = await loadUserData();
		const task = ( userData.tasks ?? [] ).find( ( t ) => t.id === taskId );
		await startTaskAgent( taskId, message, task?.sessionId, images, elements );
	}
}

/**
 * Interrupt an active task agent.
 */
export function interruptTask( taskId: string ): void {
	const active = activeTasks.get( taskId );
	if ( active ) {
		try {
			active.child.send( { type: 'ai:interrupt' } );
		} catch {
			// ignore — child may have already exited
		}
	}
}

/**
 * Respond to a pending permission request — forwarded to the CLI child.
 */
export function respondToPermissionRequest(
	requestId: string,
	response: 'allow_once' | 'allow_session' | 'deny',
	taskId?: string
): void {
	// Find which task's child process owns this permission request
	if ( taskId ) {
		const active = activeTasks.get( taskId );
		if ( active ) {
			try {
				active.child.send( { type: 'ai:permission-response', requestId, decision: response } );
			} catch {
				// ignore
			}
		}
		return;
	}

	// If no taskId, broadcast to all active tasks (one will match)
	for ( const [ , task ] of activeTasks ) {
		try {
			task.child.send( { type: 'ai:permission-response', requestId, decision: response } );
		} catch {
			// ignore
		}
	}
}

/**
 * Respond to a pending question request — forwarded to the CLI child.
 */
export function respondToQuestionRequest(
	requestId: string,
	answer: string,
	taskId?: string
): void {
	if ( taskId ) {
		const active = activeTasks.get( taskId );
		if ( active ) {
			try {
				active.child.send( { type: 'ai:question-response', requestId, answer } );
			} catch {
				// ignore
			}
		}
		return;
	}

	for ( const [ , task ] of activeTasks ) {
		try {
			task.child.send( { type: 'ai:question-response', requestId, answer } );
		} catch {
			// ignore
		}
	}
}

/**
 * Cleanup all active agents (called on app quit).
 */
export function cleanupAllAgents(): void {
	for ( const [ , task ] of activeTasks ) {
		try {
			task.child.send( { type: 'ai:kill' } );
		} catch {
			// ignore
		}
		task.child.kill();
	}
	activeTasks.clear();
}
