import { DEFAULT_MODEL, type AiModelId } from '@studio/common/ai/models';
import { emitEvent, type TurnCompletedStatus } from 'cli/ai/json-events';
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent';
import type { AiProviderId } from 'cli/ai/providers';
import type { AskUserQuestion, SiteInfo } from 'cli/ai/types';

/**
 * Fire-and-forget surface the agent loop pushes information into: lifecycle,
 * display chrome, agent-turn notifications, and turn completion. Every method
 * returns `void`, so a silent implementation is a *legitimate* contract — the
 * JSON path simply has no wire form for terminal chrome. That's why the no-op
 * defaults live on {@link HeadlessReporterBase} (inherited once) instead of
 * being hand-stubbed per adapter.
 */
export interface AgentReporter {
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

	beginAgentTurn( sessionId?: string ): void;
	endAgentTurn(): void;
	addUserMessage( text: string ): void;
	handleEvent( event: AgentSessionEvent ): void;
	emitTurnCompleted(
		status: TurnCompletedStatus,
		sessionId: string,
		usage?: { numTurns: number; costUsd?: number }
	): void;
}

/**
 * Request/response surface: it *promises a value back*, so — unlike the
 * fire-and-forget {@link AgentReporter} — a no-op or `throw` here would break
 * the caller's contract (an LSP violation). Every implementation MUST honor it
 * with a real answer; the JSON adapter does so via the desktop IPC round-trip
 * (or the documented pause-and-halt fallback), never by throwing.
 */
export interface UserInteractor {
	askUser( questions: AskUserQuestion[] ): Promise< Record< string, string > >;
}

/**
 * The polymorphic surface `runCommand` depends on. Interactive-only capabilities
 * (`waitForInput`, `openActiveSiteInBrowser`, replay, …) deliberately live only
 * on the concrete {@link AiChatUI}, reached after the `instanceof AiChatUI`
 * guard — so they cannot be invoked on a headless adapter that can't honor them.
 */
export type AiOutputAdapter = AgentReporter & UserInteractor;

/**
 * A complete, do-nothing {@link AgentReporter}. Subclasses override only the
 * methods that actually carry agent information to the consumer (and any
 * lifecycle they need); everything else stays a legitimately-silent no-op.
 */
export abstract class HeadlessReporterBase implements AgentReporter {
	currentProvider: AiProviderId = 'wpcom';
	currentModel: AiModelId = DEFAULT_MODEL;
	activeSite: SiteInfo | null = null;
	onSiteSelected: ( ( site: SiteInfo ) => void ) | null = null;
	onInterrupt: ( () => void ) | null = null;

	start(): void {}
	stop(): void {}
	showWelcome(): void {}
	showOnboarding(): void {}
	showCapabilities(): void {}
	showSuccess( _message: string ): void {}
	setBusy( _active: boolean ): void {}
	setStatusMessage( _message: string | null ): void {}
	setDaemonStatus( _state: { running: boolean; pid?: number } ): void {}
	addUserMessage( _text: string ): void {}
	endAgentTurn(): void {}

	// Information-bearing methods: a concrete reporter MUST decide how to surface
	// these, so they stay abstract rather than silently defaulting to no-op.
	abstract showProgress( message: string ): void;
	abstract showInfo( message: string ): void;
	abstract showError( message: string ): void;
	abstract setLoaderMessage( message: string, update?: boolean ): void;
	abstract beginAgentTurn( sessionId?: string ): void;
	abstract handleEvent( event: AgentSessionEvent ): void;
	abstract emitTurnCompleted(
		status: TurnCompletedStatus,
		sessionId: string,
		usage?: { numTurns: number; costUsd?: number }
	): void;
}

export class JsonAdapter extends HeadlessReporterBase implements AiOutputAdapter {
	onBeforeExit: ( () => Promise< void > ) | null = null;
	permissionResponse: Record< string, string > | null = null;

	private ipcMessageListener: ( ( message: unknown ) => void ) | null = null;
	private activeSessionId = '';

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

	showProgress( message: string ): void {
		emitEvent( { type: 'progress', timestamp: new Date().toISOString(), message } );
	}

	showInfo( message: string ): void {
		emitEvent( { type: 'info', timestamp: new Date().toISOString(), message } );
	}

	showError( message: string ): void {
		emitEvent( { type: 'error', timestamp: new Date().toISOString(), message } );
	}

	setLoaderMessage( message: string, _update?: boolean ): void {
		this.showProgress( message );
	}

	beginAgentTurn( sessionId?: string ): void {
		this.activeSessionId = sessionId ?? '';
		emitEvent( { type: 'turn.started', timestamp: new Date().toISOString() } );
	}

	handleEvent( event: AgentSessionEvent ): void {
		// Forward the event verbatim so the desktop main process can re-derive
		// state without loading the JSONL itself. The wire keeps the existing
		// `'message'` envelope, with a native AgentSessionEvent as the payload.
		emitEvent( { type: 'message', timestamp: new Date().toISOString(), message: event } );
	}

	emitTurnCompleted(
		status: TurnCompletedStatus,
		sessionId: string,
		usage?: { numTurns: number; costUsd?: number }
	): void {
		emitEvent( {
			type: 'turn.completed',
			timestamp: new Date().toISOString(),
			sessionId,
			status,
			usage,
		} );
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

		this.emitTurnCompleted( 'paused', this.activeSessionId );
		await this.onBeforeExit?.();
		process.exitCode = 0;
		return new Promise< Record< string, string > >( () => {} );
	}
}
