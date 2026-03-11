import { ChildProcess } from 'node:child_process';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';
import type {
	ChildToParentMessage,
	ParentToChildMessage,
	SerializedAgentMessage,
} from '@studio/common/types/agent-messages';

/**
 * Manages a long-lived `studio ai --pipe` child process.
 * The child process communicates via Node IPC (process.send / process.on('message')).
 */
class AgentProcessManager {
	private childProcess: ChildProcess | null = null;
	private ready = false;
	private readyPromise: Promise< void > | null = null;

	/**
	 * Ensure the agent child process is running and ready.
	 */
	async ensureProcess(): Promise< void > {
		if ( this.childProcess && ! this.childProcess.killed ) {
			if ( this.ready ) {
				return;
			}
			if ( this.readyPromise ) {
				return this.readyPromise;
			}
		}

		this.readyPromise = new Promise< void >( ( resolve, reject ) => {
			// Set ENABLE_STUDIO_AI so the ai command is registered in the child process.
			// executeCliCommand spreads process.env into the child, so setting it here is enough.
			process.env.ENABLE_STUDIO_AI = 'true';

			const [ emitter, child ] = executeCliCommand( [ 'ai', '--pipe' ], {
				output: 'capture',
				logPrefix: 'ai-agent',
			} );
			this.childProcess = child;
			this.ready = false;

			child.on( 'message', ( msg: unknown ) => {
				this.handleChildMessage( msg as ChildToParentMessage );
			} );

			child.on( 'error', ( error ) => {
				console.error( '[ai-agent] Child process error:', error );
				void sendIpcEventToRenderer( 'agent-error', {
					message: error.message,
				} );
				reject( error );
			} );

			child.on( 'close', ( code, signal ) => {
				console.log( `[ai-agent] Child process closed: code=${ code } signal=${ signal }` );
				this.childProcess = null;
				this.ready = false;
				this.readyPromise = null;
			} );

			// Listen for 'ready' message
			const onReady = ( msg: unknown ) => {
				const typed = msg as ChildToParentMessage;
				if ( typed.type === 'ready' ) {
					this.ready = true;
					resolve();
				}
			};
			child.on( 'message', onReady );

			emitter.on( 'failure', ( { error } ) => {
				reject( error );
			} );

			// Timeout if agent doesn't send 'ready' within 30s
			setTimeout( () => {
				if ( ! this.ready ) {
					reject( new Error( 'Agent process timed out waiting for ready signal' ) );
					this.destroy();
				}
			}, 30000 );
		} );

		return this.readyPromise;
	}

	private handleChildMessage( msg: ChildToParentMessage ): void {
		switch ( msg.type ) {
			case 'agent-message':
				void sendIpcEventToRenderer( 'agent-message', {
					message: msg.message as SerializedAgentMessage,
				} );
				break;
			case 'ask-user':
				void sendIpcEventToRenderer( 'agent-ask-user', {
					questions: msg.questions,
				} );
				break;
			case 'error':
				void sendIpcEventToRenderer( 'agent-error', {
					message: msg.message,
				} );
				break;
			case 'ready':
				// Already handled in ensureProcess
				break;
		}
	}

	private sendToChild( msg: ParentToChildMessage ): void {
		if ( this.childProcess && ! this.childProcess.killed && this.childProcess.connected ) {
			this.childProcess.send( msg );
		}
	}

	/**
	 * Send a prompt to the agent.
	 */
	async sendPrompt(
		prompt: string,
		options: {
			model?: string;
			resume?: string;
			siteContext?: { name: string; path: string; running: boolean };
		} = {}
	): Promise< void > {
		await this.ensureProcess();
		this.sendToChild( {
			type: 'prompt',
			prompt,
			model: options.model,
			resume: options.resume,
			siteContext: options.siteContext,
		} );
	}

	/**
	 * Interrupt the current agent turn.
	 */
	interrupt(): void {
		this.sendToChild( { type: 'interrupt' } );
	}

	/**
	 * Respond to an ask-user question from the agent.
	 */
	respondToQuestion( answers: Record< string, string > ): void {
		this.sendToChild( { type: 'ask-user-response', answers } );
	}

	/**
	 * Kill the child process and reset state.
	 */
	destroy(): void {
		if ( this.childProcess && ! this.childProcess.killed ) {
			this.childProcess.kill();
		}
		this.childProcess = null;
		this.ready = false;
		this.readyPromise = null;
	}
}

// Singleton instance
let agentProcessManager: AgentProcessManager | null = null;

export function getAgentProcessManager(): AgentProcessManager {
	if ( ! agentProcessManager ) {
		agentProcessManager = new AgentProcessManager();
	}
	return agentProcessManager;
}

export function destroyAgentProcessManager(): void {
	if ( agentProcessManager ) {
		agentProcessManager.destroy();
		agentProcessManager = null;
	}
}
