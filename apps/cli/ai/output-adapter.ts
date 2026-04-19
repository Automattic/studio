import { DEFAULT_MODEL, type AiModelId, type AskUserQuestion } from 'cli/ai/agent';
import { emitEvent, type TurnCompletedStatus } from 'cli/ai/json-events';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AiProviderId } from 'cli/ai/providers';
import type { SiteInfo } from 'cli/ai/ui';

export type HandleMessageResult =
	| { type: 'result'; sessionId: string; success: boolean }
	| { type: 'max_turns'; sessionId: string; numTurns: number; costUsd?: number };

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
	setLoaderMessage( message: string, update?: boolean ): void;

	beginAgentTurn(): void;
	endAgentTurn(): void;
	addUserMessage( text: string ): void;
	handleMessage( message: SDKMessage ): HandleMessageResult | undefined;

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

	private sessionId: string | undefined;

	start(): void {
		// No-op in JSON mode
	}

	stop(): void {
		// No-op in JSON mode
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

	setLoaderMessage( message: string, _update?: boolean ): void {
		emitEvent( { type: 'progress', timestamp: new Date().toISOString(), message } );
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

	handleMessage( message: SDKMessage ): HandleMessageResult | undefined {
		if ( message.type === 'stream_event' ) {
			const streamEvent = message.event as {
				type?: string;
				message?: { id?: string };
			};
			const messageId =
				streamEvent?.type === 'message_start' && streamEvent.message?.id
					? streamEvent.message.id
					: null;
			emitEvent( {
				type: 'message.delta',
				timestamp: new Date().toISOString(),
				messageId,
				event: message.event,
			} );
			return undefined;
		}

		emitEvent( { type: 'message', timestamp: new Date().toISOString(), message } );

		if ( message.type === 'result' ) {
			this.sessionId = message.session_id;
			if ( message.subtype === 'error_max_turns' ) {
				return {
					type: 'max_turns',
					sessionId: message.session_id,
					numTurns: message.num_turns,
					costUsd: message.total_cost_usd,
				};
			}
			return {
				type: 'result',
				sessionId: message.session_id,
				success: message.subtype === 'success',
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
		emitEvent( {
			type: 'question.asked',
			timestamp: new Date().toISOString(),
			questions: questions.map( ( q ) => ( {
				question: q.question,
				options: q.options,
			} ) ),
		} );
		this.emitTurnCompleted( 'paused' );
		await this.onBeforeExit?.();
		process.exitCode = 0;

		// Return a never-resolving promise to halt execution while letting
		// the event loop drain naturally (flushes stdout, completes async I/O).
		return new Promise< Record< string, string > >( () => {} );
	}

	openActiveSiteInBrowser(): Promise< boolean > {
		throw new Error( 'openActiveSiteInBrowser is not available in JSON mode' );
	}
}
