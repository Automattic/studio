/**
 * ACP Process Manager
 *
 * Manages spawning and lifecycle of ACP agent subprocesses using the official ACP SDK.
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { Writable } from 'stream';
import {
	ClientSideConnection,
	ndJsonStream,
	type Client,
	type SessionNotification,
	type RequestPermissionRequest,
	type RequestPermissionResponse,
	type ReadTextFileRequest,
	type ReadTextFileResponse,
	type WriteTextFileRequest,
	type WriteTextFileResponse,
	type CreateTerminalRequest,
	type CreateTerminalResponse,
	type TerminalOutputRequest,
	type TerminalOutputResponse,
	type ReleaseTerminalRequest,
	type ReleaseTerminalResponse,
	type WaitForTerminalExitRequest,
	type WaitForTerminalExitResponse,
	type KillTerminalCommandRequest,
	type KillTerminalCommandResponse,
	type NewSessionResponse,
	type PromptResponse,
} from '@agentclientprotocol/sdk';
import { detectAgentById, getAugmentedPath } from './agent-detection';
import type { AgentConfig, AcpSession } from '../types';
import type * as pty from 'node-pty';

function loadPty(): typeof import('node-pty') {
	try {
		return require( 'node-pty' );
	} catch ( error ) {
		throw new Error(
			'node-pty is required to run this agent. Please install dependencies and try again.'
		);
	}
}

/**
 * Callback handler for file system operations.
 */
export interface AcpCallbackHandler {
	readTextFile?: ( path: string ) => Promise< string >;
	writeTextFile?: ( path: string, content: string ) => Promise< void >;
	requestPermission?: (
		toolCall: unknown,
		options: Array< { optionId: string; name: string; kind: string } >
	) => Promise< { outcome: 'selected' | 'cancelled'; optionId?: string } >;
}

/**
 * Terminal instance for ACP terminal capability.
 */
interface AcpTerminal {
	id: string;
	process: ChildProcess;
	output: string;
	outputByteLimit: number;
	exitCode: number | null;
	exitSignal: string | null;
	exited: boolean;
	exitPromise: Promise< void >;
	exitResolve: () => void;
}

/**
 * Running ACP process state.
 */
interface RunningProcess {
	agentId: string;
	siteId: string;
	workingDirectory: string;
	process: ChildProcess | pty.IPty;
	connection: ClientSideConnection;
	session: AcpSession;
	callbackHandler?: AcpCallbackHandler;
	terminals: Map< string, AcpTerminal >;
	terminalCounter: number;
}

/**
 * ACP Process Manager.
 *
 * Manages the lifecycle of ACP agent subprocesses using the official ACP SDK.
 */
export class AcpProcessManager extends EventEmitter {
	private processes: Map< string, RunningProcess > = new Map();
	private sessionCounter = 0;

	constructor() {
		super();
	}

	/**
	 * Generate a unique session ID.
	 */
	private nextSessionId(): string {
		return `acp-session-${ Date.now() }-${ ++this.sessionCounter }`;
	}

	private isPtyProcess( proc: ChildProcess | pty.IPty ): proc is pty.IPty {
		return typeof ( proc as pty.IPty ).onData === 'function';
	}

	private getProcessStreams( proc: ChildProcess | pty.IPty ): {
		input: WritableStream< Uint8Array >;
		output: ReadableStream< Uint8Array >;
	} {
		if ( this.isPtyProcess( proc ) ) {
			const encoder = new TextEncoder();
			const decoder = new TextDecoder();

			const input = new WritableStream< Uint8Array >( {
				write( chunk ) {
					proc.write( decoder.decode( chunk ) );
				},
			} );

			const output = new ReadableStream< Uint8Array >( {
				start( controller ) {
					proc.onData( ( data ) => {
						controller.enqueue( encoder.encode( data ) );
					} );
					proc.onExit( () => controller.close() );
				},
			} );

			return { input, output };
		}

		const input = Writable.toWeb( proc.stdin! ) as WritableStream< Uint8Array >;

		// Some agents (like codex-acp) write JSON-RPC to stderr instead of stdout,
		// and may also echo requests back. We need to:
		// 1. Combine stdout and stderr
		// 2. Filter out echoed requests (messages with 'method' field that we sent)
		// 3. Only pass through responses and valid incoming requests from the agent
		const encoder = new TextEncoder();
		let buffer = '';

		const output = new ReadableStream< Uint8Array >( {
			start( controller ) {
				const processData = ( data: Buffer ) => {
					buffer += data.toString();
					const lines = buffer.split( '\n' );
					buffer = lines.pop() || '';

					for ( const line of lines ) {
						const trimmed = line.trim();
						if ( ! trimmed ) {
							continue;
						}

						// Try to parse as JSON to filter echoed requests
						try {
							const msg = JSON.parse( trimmed );

							// Skip echoed requests - these are requests WE sent that the agent echoes back
							// They have 'method' field AND 'id' field (requests we send always have IDs)
							// Valid incoming requests from agent (callbacks) also have 'method' but we should handle those
							// The key is: our outgoing requests use methods like 'initialize', 'newSession', 'prompt'
							// Agent callbacks use methods like 'readTextFile', 'writeTextFile', etc.
							const echoMethods = [ 'initialize', 'newSession', 'prompt', 'cancel' ];
							if ( msg.method && msg.id !== undefined && echoMethods.includes( msg.method ) ) {
								// This looks like an echoed request, skip it
								console.log( `ACP: Skipping echoed request: ${ msg.method }` );
								continue;
							}

							// Pass through responses (have result or error) and valid callbacks
							controller.enqueue( encoder.encode( trimmed + '\n' ) );
						} catch {
							// Not valid JSON, skip (log messages, spinners, etc.)
						}
					}
				};

				proc.stdout?.on( 'data', processData );
				proc.stderr?.on( 'data', processData );
				proc.on( 'exit', () => controller.close() );
				proc.on( 'error', () => controller.close() );
			},
		} );

		return { input, output };
	}

	/**
	 * Create a new ACP session with an agent.
	 */
	async createSession(
		agentId: string,
		siteId: string,
		workingDirectory: string,
		callbackHandler?: AcpCallbackHandler
	): Promise< AcpSession > {
		const agentConfig = await detectAgentById( agentId );

		if ( ! agentConfig ) {
			throw new Error( `Unknown agent: ${ agentId }` );
		}

		if ( agentConfig.provider !== 'acp' ) {
			throw new Error( `Agent ${ agentId } is not an ACP agent` );
		}

		if ( agentConfig.status === 'unavailable' ) {
			throw new Error( `Agent ${ agentId } is not available` );
		}

		if ( ! agentConfig.command ) {
			throw new Error( `Agent ${ agentId } has no command defined` );
		}

		const sessionId = this.nextSessionId();

		// Create session object
		const session: AcpSession = {
			id: sessionId,
			agentId,
			siteId,
			state: 'starting',
			createdAt: Date.now(),
		};

		try {
			// Spawn the agent process
			console.log(
				`ACP [${ sessionId }] Spawning agent: ${ agentConfig.command } ${ (
					agentConfig.args ?? []
				).join( ' ' ) }`
			);
			const proc = this.spawnAgent( agentConfig, workingDirectory );
			console.log( `ACP [${ sessionId }] Process spawned with PID: ${ proc.pid }` );

			// Convert Node streams to Web streams for the SDK
			const io = this.getProcessStreams( proc );

			// Create the ACP stream
			const stream = ndJsonStream( io.input, io.output );
			console.log( `ACP [${ sessionId }] Stream created` );

			// Create the client handler that will receive agent callbacks
			const clientHandler = this.createClientHandler( sessionId, callbackHandler );

			// Create the connection using the official SDK
			const connection = new ClientSideConnection( () => clientHandler, stream );
			console.log( `ACP [${ sessionId }] Connection created` );

			// Store the running process
			const runningProcess: RunningProcess = {
				agentId,
				siteId,
				workingDirectory,
				process: proc,
				connection,
				session,
				callbackHandler,
				terminals: new Map(),
				terminalCounter: 0,
			};

			this.processes.set( sessionId, runningProcess );

			// Set up process event handlers
			this.setupProcessHandlers( sessionId, proc );

			// Initialize the connection and create session
			console.log( `ACP [${ sessionId }] Starting initialization...` );
			const newSessionResult = await this.initializeSession( sessionId, workingDirectory );
			console.log( `ACP [${ sessionId }] Initialization complete:`, newSessionResult );

			// Update session state
			session.pid = proc.pid;
			session.state = 'ready';
			session.acpSessionId = newSessionResult.sessionId;

			// Store model info if available
			if ( newSessionResult.models ) {
				session.models = {
					availableModels: newSessionResult.models.availableModels.map( ( m ) => ( {
						modelId: m.modelId,
						name: m.name,
						description: m.description ?? undefined,
					} ) ),
					currentModelId: newSessionResult.models.currentModelId,
				};
				console.log(
					`ACP [${ sessionId }] Models available:`,
					session.models.availableModels.map( ( m ) => m.name )
				);
			}

			this.emit( 'session_ready', sessionId, newSessionResult );

			return session;
		} catch ( error ) {
			session.state = 'error';
			session.error = error instanceof Error ? error.message : String( error );
			this.processes.delete( sessionId );
			throw error;
		}
	}

	/**
	 * Parse a command string into command and arguments.
	 * Handles quoted strings and basic shell escaping.
	 *
	 * Examples:
	 * - "ls -la" -> { command: "ls", args: ["-la"] }
	 * - "echo 'hello world'" -> { command: "echo", args: ["hello world"] }
	 * - "git commit -m 'fix bug'" -> { command: "git", args: ["commit", "-m", "fix bug"] }
	 */
	private parseCommandString( commandStr: string ): { command: string; args: string[] } {
		const tokens: string[] = [];
		let currentToken = '';
		let inSingleQuote = false;
		let inDoubleQuote = false;
		let escaped = false;

		for ( let i = 0; i < commandStr.length; i++ ) {
			const char = commandStr[ i ];

			if ( escaped ) {
				currentToken += char;
				escaped = false;
				continue;
			}

			if ( char === '\\' && ! inSingleQuote ) {
				escaped = true;
				continue;
			}

			if ( char === "'" && ! inDoubleQuote ) {
				inSingleQuote = ! inSingleQuote;
				continue;
			}

			if ( char === '"' && ! inSingleQuote ) {
				inDoubleQuote = ! inDoubleQuote;
				continue;
			}

			if ( char === ' ' && ! inSingleQuote && ! inDoubleQuote ) {
				if ( currentToken ) {
					tokens.push( currentToken );
					currentToken = '';
				}
				continue;
			}

			currentToken += char;
		}

		if ( currentToken ) {
			tokens.push( currentToken );
		}

		if ( tokens.length === 0 ) {
			return { command: commandStr, args: [] };
		}

		return {
			command: tokens[ 0 ],
			args: tokens.slice( 1 ),
		};
	}

	/**
	 * Create a Client handler for the ACP connection.
	 */
	private createClientHandler( sessionId: string, callbackHandler?: AcpCallbackHandler ): Client {
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this;

		const getRunningProcess = () => {
			const proc = self.processes.get( sessionId );
			if ( ! proc ) {
				throw new Error( `Session not found: ${ sessionId }` );
			}
			return proc;
		};

		return {
			// Handle session updates (streaming content from agent)
			async sessionUpdate( params: SessionNotification ): Promise< void > {
				console.log(
					`ACP [${ sessionId }] sessionUpdate received:`,
					JSON.stringify( params ).slice( 0, 500 )
				);
				self.emit( 'session_update', sessionId, params );
			},

			// Handle permission requests from agent
			async requestPermission(
				params: RequestPermissionRequest
			): Promise< RequestPermissionResponse > {
				if ( callbackHandler?.requestPermission ) {
					const result = await callbackHandler.requestPermission(
						params.toolCall,
						params.options.map( ( opt ) => ( {
							optionId: opt.optionId,
							name: opt.name,
							kind: opt.kind,
						} ) )
					);

					if ( result.outcome === 'cancelled' ) {
						return { outcome: { outcome: 'cancelled' } };
					}

					return {
						outcome: {
							outcome: 'selected',
							optionId: result.optionId!,
						},
					};
				}

				return { outcome: { outcome: 'cancelled' } };
			},

			// Handle file read requests from agent
			async readTextFile( params: ReadTextFileRequest ): Promise< ReadTextFileResponse > {
				if ( callbackHandler?.readTextFile ) {
					const content = await callbackHandler.readTextFile( params.path );
					return { content };
				}
				throw new Error( 'File read not supported' );
			},

			// Handle file write requests from agent
			async writeTextFile( params: WriteTextFileRequest ): Promise< WriteTextFileResponse > {
				if ( callbackHandler?.writeTextFile ) {
					await callbackHandler.writeTextFile( params.path, params.content );
					return {};
				}
				throw new Error( 'File write not supported' );
			},

			// Create a new terminal and execute a command
			async createTerminal( params: CreateTerminalRequest ): Promise< CreateTerminalResponse > {
				const runningProcess = getRunningProcess();
				const terminalId = `terminal-${ ++runningProcess.terminalCounter }`;
				const outputByteLimit = Number( params.outputByteLimit ?? 1024 * 1024 ); // Default 1MB

				console.log(
					`ACP [${ sessionId }] createTerminal: ${ params.command } ${ ( params.args ?? [] ).join(
						' '
					) }`
				);
				console.log(
					`ACP [${ sessionId }] createTerminal params.cwd: ${
						params.cwd ?? '(not set, will use session working directory)'
					}`
				);
				console.log(
					`ACP [${ sessionId }] createTerminal session workingDirectory: ${ runningProcess.workingDirectory }`
				);
				console.log( `ACP [${ sessionId }] createTerminal process.cwd(): ${ process.cwd() }` );

				// Use the session's working directory as fallback instead of process.cwd()
				// This ensures commands run in the site directory, not the Studio app directory
				const effectiveCwd = params.cwd ?? runningProcess.workingDirectory;
				console.log( `ACP [${ sessionId }] createTerminal effective cwd: ${ effectiveCwd }` );

				// Build environment
				const env: Record< string, string > = { ...process.env } as Record< string, string >;
				env.PATH = getAugmentedPath();
				if ( params.env ) {
					for ( const { name, value } of params.env ) {
						env[ name ] = value;
					}
				}

				let exitResolve: () => void = () => {};
				const exitPromise = new Promise< void >( ( resolve ) => {
					exitResolve = resolve;
				} );

				const terminal: AcpTerminal = {
					id: terminalId,
					process: null as unknown as ChildProcess,
					output: '',
					outputByteLimit,
					exitCode: null,
					exitSignal: null,
					exited: false,
					exitPromise,
					exitResolve,
				};

				// Parse command if it contains spaces but no args provided
				// This handles cases where the agent sends "ls -la" as a single command string
				let command = params.command;
				let args = params.args ?? [];

				if ( ( ! args || args.length === 0 ) && command.includes( ' ' ) ) {
					console.log( `ACP [${ sessionId }] Parsing command string: "${ command }"` );
					const parsed = self.parseCommandString( command );
					command = parsed.command;
					args = parsed.args;
					console.log(
						`ACP [${ sessionId }] Parsed to: command="${ command }", args=${ JSON.stringify(
							args
						) }`
					);
				}

				// Spawn the process with the effective working directory
				const proc = spawn( command, args, {
					cwd: effectiveCwd,
					env,
					stdio: [ 'pipe', 'pipe', 'pipe' ],
					shell: false,
				} );

				terminal.process = proc;

				// Collect output
				const appendOutput = ( data: Buffer ) => {
					terminal.output += data.toString();
					// Truncate from beginning if exceeds limit
					if ( terminal.output.length > outputByteLimit ) {
						terminal.output = terminal.output.slice( -outputByteLimit );
					}
				};

				proc.stdout?.on( 'data', appendOutput );
				proc.stderr?.on( 'data', appendOutput );

				proc.on( 'exit', ( code, signal ) => {
					terminal.exitCode = code;
					terminal.exitSignal = signal ?? null;
					terminal.exited = true;
					terminal.exitResolve();
				} );

				proc.on( 'error', ( error ) => {
					terminal.output += `\nError: ${ error.message }`;
					terminal.exited = true;
					terminal.exitCode = 1;
					terminal.exitResolve();
				} );

				runningProcess.terminals.set( terminalId, terminal );

				return { terminalId };
			},

			// Get current terminal output
			async terminalOutput( params: TerminalOutputRequest ): Promise< TerminalOutputResponse > {
				const runningProcess = getRunningProcess();
				const terminal = runningProcess.terminals.get( params.terminalId );

				if ( ! terminal ) {
					throw new Error( `Terminal not found: ${ params.terminalId }` );
				}

				const response: TerminalOutputResponse = {
					output: terminal.output,
					truncated: terminal.output.length >= terminal.outputByteLimit,
				};

				if ( terminal.exited ) {
					response.exitStatus = {
						exitCode: terminal.exitCode,
						signal: terminal.exitSignal,
					};
				}

				return response;
			},

			// Wait for terminal to exit
			async waitForTerminalExit(
				params: WaitForTerminalExitRequest
			): Promise< WaitForTerminalExitResponse > {
				const runningProcess = getRunningProcess();
				const terminal = runningProcess.terminals.get( params.terminalId );

				if ( ! terminal ) {
					throw new Error( `Terminal not found: ${ params.terminalId }` );
				}

				await terminal.exitPromise;

				return {
					exitCode: terminal.exitCode,
					signal: terminal.exitSignal,
				};
			},

			// Kill terminal command without releasing
			async killTerminal(
				params: KillTerminalCommandRequest
			): Promise< KillTerminalCommandResponse > {
				const runningProcess = getRunningProcess();
				const terminal = runningProcess.terminals.get( params.terminalId );

				if ( ! terminal ) {
					throw new Error( `Terminal not found: ${ params.terminalId }` );
				}

				if ( ! terminal.exited ) {
					terminal.process.kill( 'SIGTERM' );
					// Force kill after timeout
					setTimeout( () => {
						if ( ! terminal.exited ) {
							terminal.process.kill( 'SIGKILL' );
						}
					}, 1000 );
				}

				return {};
			},

			// Release terminal and free resources
			async releaseTerminal( params: ReleaseTerminalRequest ): Promise< ReleaseTerminalResponse > {
				const runningProcess = getRunningProcess();
				const terminal = runningProcess.terminals.get( params.terminalId );

				if ( ! terminal ) {
					return {};
				}

				// Kill if still running
				if ( ! terminal.exited ) {
					terminal.process.kill( 'SIGKILL' );
				}

				runningProcess.terminals.delete( params.terminalId );

				return {};
			},
		};
	}

	/**
	 * Spawn an ACP agent process.
	 */
	private spawnAgent( agentConfig: AgentConfig, workingDirectory: string ): ChildProcess {
		const command = agentConfig.command!;
		const args = agentConfig.args ?? [];

		// Prepare environment with augmented PATH
		const env: Record< string, string | undefined > = {
			...process.env,
			PATH: getAugmentedPath(),
		};

		// Merge agent-specific environment variables
		if ( agentConfig.env ) {
			Object.assign( env, agentConfig.env );
		}

		if ( agentConfig.requiresTty ) {
			const ptyModule = loadPty();
			const ptyProc = ptyModule.spawn( command, args, {
				name: 'xterm-256color',
				cols: 120,
				rows: 40,
				cwd: workingDirectory,
				env: env as Record< string, string >,
			} );
			return ptyProc as unknown as ChildProcess;
		}

		const proc = spawn( command, args, {
			cwd: workingDirectory,
			env,
			stdio: [ 'pipe', 'pipe', 'pipe' ],
		} );

		return proc;
	}

	/**
	 * Set up event handlers for a process.
	 */
	private setupProcessHandlers( sessionId: string, proc: ChildProcess ): void {
		const runningProcess = this.processes.get( sessionId );
		if ( ! runningProcess ) {
			return;
		}

		// Handle stderr for PTY processes only (for debugging/errors)
		// Note: For non-PTY processes, stderr is combined with stdout for JSON-RPC
		// (some agents like codex-acp write JSON-RPC to stderr)
		if ( this.isPtyProcess( proc ) ) {
			proc.onData( ( data ) => {
				console.warn( `ACP [${ sessionId }] data:`, data );
				this.emit( 'stderr', sessionId, data );
			} );
		}

		// Handle process exit
		if ( this.isPtyProcess( proc ) ) {
			proc.onExit( ( event ) => {
				console.log(
					`ACP [${ sessionId }] exited with code ${ event.exitCode }, signal ${ event.signal }`
				);

				runningProcess.session.state = 'closed';
				this.processes.delete( sessionId );

				this.emit( 'session_closed', sessionId, event.exitCode, event.signal );
			} );
		} else {
			proc.on( 'exit', ( code, signal ) => {
				console.log( `ACP [${ sessionId }] exited with code ${ code }, signal ${ signal }` );

				runningProcess.session.state = 'closed';
				this.processes.delete( sessionId );

				this.emit( 'session_closed', sessionId, code, signal );
			} );
		}

		// Handle process errors
		if ( ! this.isPtyProcess( proc ) ) {
			proc.on( 'error', ( error ) => {
				console.error( `ACP [${ sessionId }] error:`, error );

				runningProcess.session.state = 'error';
				runningProcess.session.error = error.message;

				this.emit( 'session_error', sessionId, error );
			} );
		}
	}

	/**
	 * Helper to add timeout to a promise.
	 */
	private withTimeout< T >(
		promise: Promise< T >,
		timeoutMs: number,
		operation: string
	): Promise< T > {
		return Promise.race( [
			promise,
			new Promise< T >( ( _, reject ) => {
				setTimeout(
					() => reject( new Error( `${ operation } timed out after ${ timeoutMs }ms` ) ),
					timeoutMs
				);
			} ),
		] );
	}

	/**
	 * Initialize the ACP connection and create a session.
	 */
	private async initializeSession(
		sessionId: string,
		workingDirectory: string
	): Promise< NewSessionResponse > {
		const runningProcess = this.processes.get( sessionId );
		if ( ! runningProcess ) {
			throw new Error( `Session not found: ${ sessionId }` );
		}

		const { connection } = runningProcess;

		try {
			// Step 1: Initialize the connection
			console.log( `ACP [${ sessionId }] Calling initialize()...` );
			const initResult = await this.withTimeout(
				connection.initialize( {
					protocolVersion: 1,
					clientInfo: {
						name: 'WordPress Studio',
						version: '1.0.0',
					},
					clientCapabilities: {
						fs: {
							readTextFile: true,
							writeTextFile: true,
						},
						terminal: true,
					},
				} ),
				30000,
				'initialize()'
			);
			console.log( `ACP [${ sessionId }] initialize() complete:`, initResult );

			// Step 2: Create the session
			console.log( `ACP [${ sessionId }] Calling newSession() with cwd: ${ workingDirectory }` );
			console.log(
				`ACP [${ sessionId }] Current process.cwd() before newSession: ${ process.cwd() }`
			);
			const result = await this.withTimeout(
				connection.newSession( {
					cwd: workingDirectory,
					mcpServers: [],
				} ),
				30000,
				'newSession()'
			);
			console.log( `ACP [${ sessionId }] newSession() complete:`, result );
			console.log(
				`ACP [${ sessionId }] Current process.cwd() after newSession: ${ process.cwd() }`
			);

			return result;
		} catch ( error ) {
			console.error( `ACP [${ sessionId }] Initialization failed:`, error );
			throw error;
		}
	}

	/**
	 * Send a prompt to an active session.
	 */
	async sendPrompt( sessionId: string, prompt: string ): Promise< PromptResponse > {
		console.log( `ACP [${ sessionId }] sendPrompt called with: "${ prompt.slice( 0, 100 ) }..."` );

		const runningProcess = this.processes.get( sessionId );
		if ( ! runningProcess ) {
			throw new Error( `Session not found: ${ sessionId }` );
		}

		if ( runningProcess.session.state !== 'ready' ) {
			throw new Error( `Session not ready: ${ runningProcess.session.state }` );
		}

		const { connection, session } = runningProcess;

		console.log(
			`ACP [${ sessionId }] Calling connection.prompt() with acpSessionId: ${ session.acpSessionId }`
		);

		// Send the prompt using the SDK
		const result = await connection.prompt( {
			sessionId: session.acpSessionId!,
			prompt: [
				{
					type: 'text',
					text: prompt,
				},
			],
		} );

		console.log( `ACP [${ sessionId }] prompt() complete:`, result );

		return result;
	}

	/**
	 * Cancel an ongoing prompt.
	 */
	async cancelPrompt( sessionId: string ): Promise< void > {
		const runningProcess = this.processes.get( sessionId );
		if ( ! runningProcess ) {
			throw new Error( `Session not found: ${ sessionId }` );
		}

		const { connection, session } = runningProcess;

		await connection.cancel( {
			sessionId: session.acpSessionId!,
		} );
	}

	/**
	 * Set the model for a session.
	 * Only works if the agent supports model selection.
	 */
	async setModel( sessionId: string, modelId: string ): Promise< void > {
		const runningProcess = this.processes.get( sessionId );
		if ( ! runningProcess ) {
			throw new Error( `Session not found: ${ sessionId }` );
		}

		const { connection, session } = runningProcess;

		if ( ! session.models ) {
			throw new Error( 'Agent does not support model selection' );
		}

		console.log( `ACP [${ sessionId }] Setting model to: ${ modelId }` );

		// Use the unstable_setSessionModel method from the SDK
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result = await ( connection as any ).unstable_setSessionModel( {
			sessionId: session.acpSessionId!,
			modelId,
		} );

		// Update the session's current model
		session.models.currentModelId = modelId;

		console.log( `ACP [${ sessionId }] Model set to: ${ modelId }`, result );

		this.emit( 'model_changed', sessionId, modelId );
	}

	/**
	 * Get the current model state for a session.
	 */
	getSessionModels( sessionId: string ): {
		availableModels: Array< { modelId: string; name: string; description?: string } >;
		currentModelId: string;
	} | null {
		const runningProcess = this.processes.get( sessionId );
		if ( ! runningProcess ) {
			return null;
		}

		return runningProcess.session.models ?? null;
	}

	/**
	 * Close a session.
	 */
	async closeSession( sessionId: string ): Promise< void > {
		const runningProcess = this.processes.get( sessionId );
		if ( ! runningProcess ) {
			return;
		}

		const { process: proc } = runningProcess;

		if ( this.isPtyProcess( proc ) ) {
			proc.kill();
		} else {
			// Kill the process
			proc.kill( 'SIGTERM' );

			// Give it a moment, then force kill if needed
			setTimeout( () => {
				if ( ! proc.killed ) {
					proc.kill( 'SIGKILL' );
				}
			}, 3000 );
		}

		runningProcess.session.state = 'closed';
		this.processes.delete( sessionId );
	}

	/**
	 * Close all sessions.
	 */
	async closeAllSessions(): Promise< void > {
		const sessionIds = Array.from( this.processes.keys() );

		await Promise.all( sessionIds.map( ( id ) => this.closeSession( id ) ) );
	}

	/**
	 * Get a session by ID.
	 */
	getSession( sessionId: string ): AcpSession | undefined {
		return this.processes.get( sessionId )?.session;
	}

	/**
	 * Get all active sessions.
	 */
	getAllSessions(): AcpSession[] {
		return Array.from( this.processes.values() ).map( ( p ) => p.session );
	}

	/**
	 * Get sessions for a specific site.
	 */
	getSessionsForSite( siteId: string ): AcpSession[] {
		return Array.from( this.processes.values() )
			.filter( ( p ) => p.siteId === siteId )
			.map( ( p ) => p.session );
	}

	/**
	 * Check if a session is active.
	 */
	isSessionActive( sessionId: string ): boolean {
		const session = this.getSession( sessionId );
		return session?.state === 'ready';
	}
}

// Singleton instance
let processManagerInstance: AcpProcessManager | null = null;

/**
 * Get the singleton ACP process manager instance.
 */
export function getAcpProcessManager(): AcpProcessManager {
	if ( ! processManagerInstance ) {
		processManagerInstance = new AcpProcessManager();
	}
	return processManagerInstance;
}
