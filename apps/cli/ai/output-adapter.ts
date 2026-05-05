import { DEFAULT_MODEL, type AiModelId, type AskUserQuestion } from 'cli/ai/agent';
import { emitEvent, type TurnCompletedStatus } from 'cli/ai/json-events';
import type { AiProviderId } from 'cli/ai/providers';
import type { AgentRuntimeEvent } from 'cli/ai/runtimes/runtime-events';
import type { SiteInfo } from 'cli/ai/ui';

export type HandleEventResult = {
	type: 'result';
	sessionId: string;
	success: boolean;
	interrupted?: boolean;
};

export interface AiOutputAdapter {
	currentProvider: AiProviderId;
	currentModel: AiModelId;
	activeSite: SiteInfo | null;
	onSiteSelected: ( ( site: SiteInfo ) => void ) | null;
	onInterrupt: ( () => void ) | null;

	start(): void;
	stop(): void;
	showWelcome(): void;
	showOnboarding(): void;
	showCapabilities(): void;
	showSuccess( message: string ): void;
	showProgress( message: string ): void;
	setBusy( active: boolean ): void;

	showInfo( message: string ): void;
	showError( message: string ): void;
	setStatusMessage( message: string | null ): void;
	setDaemonStatus( state: { running: boolean; pid?: number } ): void;
	setLoaderMessage( message: string, update?: boolean ): void;

	beginAgentTurn(): void;
	endAgentTurn(): void;
	addUserMessage( text: string ): void;
	handleEvent( event: AgentRuntimeEvent ): HandleEventResult | undefined;

	waitForInput(): Promise< string >;
	askUser( questions: AskUserQuestion[] ): Promise< Record< string, string > >;
	openActiveSiteInBrowser(): Promise< boolean >;
}

export class JsonAdapter implements AiOutputAdapter {
	currentProvider: AiProviderId = 'wpcom';
	currentModel: AiModelId = DEFAULT_MODEL;
	activeSite: SiteInfo | null = null;
	onSiteSelected: ( ( site: SiteInfo ) => void ) | null = null;
	onInterrupt: ( () => void ) | null = null;
	onBeforeExit: ( () => Promise< void > ) | null = null;
	permissionResponse: Record< string, string > | null = null;

	private sessionId: string | undefined;
	private ipcMessageListener: ( ( message: unknown ) => void ) | null = null;

	start(): void {
		// When forked from Studio, route the parent's IPC `interrupt` message
		// to onInterrupt. SIGTERM from the parent is swallowed by module-level
		// handlers (e.g. wordpress-server-manager), so we can't rely on signals.
		if ( typeof process.send !== 'function' ) {
			return;
		}
		this.ipcMessageListener = ( message ) => {
			if (
				message &&
				typeof message === 'object' &&
				( message as { type?: string } ).type === 'interrupt'
			) {
				this.onInterrupt?.();
			}
		};
		process.on( 'message', this.ipcMessageListener );
	}

	stop(): void {
		if ( this.ipcMessageListener ) {
			process.off( 'message', this.ipcMessageListener );
			this.ipcMessageListener = null;
		}
	}

	showWelcome(): void {
		// No-op in JSON mode
	}

	showOnboarding(): void {
		// No-op in JSON mode
	}

	showCapabilities(): void {
		// No-op in JSON mode
	}

	showSuccess( _message: string ): void {
		// No-op in JSON mode
	}

	showProgress( message: string ): void {
		emitEvent( { type: 'progress', timestamp: new Date().toISOString(), message } );
	}

	setBusy( _active: boolean ): void {
		// No-op in JSON mode
	}

	showInfo( message: string ): void {
		emitEvent( { type: 'info', timestamp: new Date().toISOString(), message } );
	}

	showError( message: string ): void {
		emitEvent( { type: 'error', timestamp: new Date().toISOString(), message } );
	}

	setStatusMessage(): void {
		// No-op in JSON mode
	}

	setDaemonStatus(): void {
		// No-op in JSON mode
	}

	setLoaderMessage( message: string, _update?: boolean ): void {
		this.showProgress( message );
	}

	beginAgentTurn(): void {
		emitEvent( { type: 'turn.started', timestamp: new Date().toISOString() } );
	}

	endAgentTurn(): void {
		// turn.completed is emitted separately with status and usage
	}

	addUserMessage( _text: string ): void {
		// No-op in JSON mode — the service already knows the message it sent
	}

	handleEvent( event: AgentRuntimeEvent ): HandleEventResult | undefined {
		// Forward the event verbatim so the desktop main process can re-derive
		// state without loading the JSONL itself. The wire keeps the legacy
		// `'message'` envelope for compatibility with the renderer's parser,
		// but the inner payload is now the native AgentRuntimeEvent.
		emitEvent( { type: 'message', timestamp: new Date().toISOString(), message: event } );

		if ( event.type === 'turn_completed' ) {
			this.sessionId = event.sessionId;
			return {
				type: 'result',
				sessionId: event.sessionId,
				success: ! event.isError,
			};
		}

		return undefined;
	}

	emitTurnCompleted(
		status: TurnCompletedStatus,
		usage?: { numTurns: number; costUsd?: number }
	): void {
		emitEvent( {
			type: 'turn.completed',
			timestamp: new Date().toISOString(),
			sessionId: this.sessionId ?? '',
			status,
			usage,
		} );
	}

	waitForInput(): Promise< string > {
		throw new Error( 'waitForInput is not available in JSON mode' );
	}

	async askUser( questions: AskUserQuestion[] ): Promise< Record< string, string > > {
		// If a permission response was pre-supplied (e.g. from desktop app),
		// return it immediately instead of pausing.
		if ( this.permissionResponse ) {
			const response = this.permissionResponse;
			this.permissionResponse = null;
			return response;
		}

		emitEvent( {
			type: 'question.asked',
			timestamp: new Date().toISOString(),
			questions: questions.map( ( q ) => ( {
				question: q.question,
				options: q.options,
			} ) ),
		} );

		// When forked from the Studio main process, wait for answers to come
		// back over the Node IPC channel. For standalone CLI `--json` use
		// (piped through a shell) there's no parent, so fall back to the
		// original "emit paused turn and halt" behavior.
		if ( typeof process.send === 'function' ) {
			return new Promise< Record< string, string > >( ( resolve ) => {
				const onMessage = ( message: unknown ) => {
					if (
						message &&
						typeof message === 'object' &&
						( message as { type?: string } ).type === 'answer'
					) {
						const answers = ( message as { answers?: Record< string, string > } ).answers;
						process.off( 'message', onMessage );
						resolve( answers ?? {} );
					}
				};
				process.on( 'message', onMessage );
			} );
		}

		this.emitTurnCompleted( 'paused' );
		await this.onBeforeExit?.();
		process.exitCode = 0;
		return new Promise< Record< string, string > >( () => {} );
	}

	openActiveSiteInBrowser(): Promise< boolean > {
		throw new Error( 'openActiveSiteInBrowser is not available in JSON mode' );
	}
}
