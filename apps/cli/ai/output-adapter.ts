import { emitEvent, type TurnCompletedStatus } from 'cli/ai/json-events';
import { AiChatUI, type SiteInfo } from 'cli/ai/ui';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AiModelId, AskUserQuestion } from 'cli/ai/agent';
import type { AiProviderId } from 'cli/ai/providers';

export type HandleMessageResult =
	| { sessionId: string; success: boolean; maxTurnsReached?: undefined }
	| { sessionId: string; maxTurnsReached: true; numTurns: number; costUsd?: number };

export interface AiOutputAdapter {
	currentProvider: AiProviderId;
	currentModel: AiModelId;
	activeSite: SiteInfo | null;
	onSiteSelected: ( ( site: SiteInfo ) => void ) | null;
	onInterrupt: ( () => void ) | null;

	start(): void;
	stop(): void;
	showWelcome(): void;

	showInfo( message: string ): void;
	showError( message: string ): void;
	setStatusMessage( message: string | null ): void;
	setLoaderMessage( message: string ): void;

	beginAgentTurn(): void;
	endAgentTurn(): void;
	addUserMessage( text: string ): void;
	handleMessage( message: SDKMessage ): HandleMessageResult | undefined;

	waitForInput(): Promise< string >;
	askUser( questions: AskUserQuestion[] ): Promise< Record< string, string > >;
	openActiveSiteInBrowser(): Promise< boolean >;
}

export class InteractiveAdapter implements AiOutputAdapter {
	readonly chatUI: AiChatUI;
	private ui: AiChatUI;

	constructor() {
		this.ui = new AiChatUI();
		this.chatUI = this.ui;
	}

	get currentProvider(): AiProviderId {
		return this.ui.currentProvider;
	}
	set currentProvider( value: AiProviderId ) {
		this.ui.currentProvider = value;
	}

	get currentModel(): AiModelId {
		return this.ui.currentModel;
	}
	set currentModel( value: AiModelId ) {
		this.ui.currentModel = value;
	}

	get activeSite(): SiteInfo | null {
		return this.ui.activeSite;
	}

	get onSiteSelected(): ( ( site: SiteInfo ) => void ) | null {
		return this.ui.onSiteSelected;
	}
	set onSiteSelected( fn: ( ( site: SiteInfo ) => void ) | null ) {
		this.ui.onSiteSelected = fn;
	}

	get onInterrupt(): ( () => void ) | null {
		return this.ui.onInterrupt;
	}
	set onInterrupt( fn: ( () => void ) | null ) {
		this.ui.onInterrupt = fn;
	}

	start(): void {
		this.ui.start();
	}

	stop(): void {
		this.ui.stop();
	}

	showWelcome(): void {
		this.ui.showWelcome();
	}

	showInfo( message: string ): void {
		this.ui.showInfo( message );
	}

	showError( message: string ): void {
		this.ui.showError( message );
	}

	setStatusMessage( message: string | null ): void {
		this.ui.setStatusMessage( message );
	}

	setLoaderMessage( message: string ): void {
		this.ui.setLoaderMessage( message );
	}

	beginAgentTurn(): void {
		this.ui.beginAgentTurn();
	}

	endAgentTurn(): void {
		this.ui.endAgentTurn();
	}

	addUserMessage( text: string ): void {
		this.ui.addUserMessage( text );
	}

	handleMessage( message: SDKMessage ): HandleMessageResult | undefined {
		return this.ui.handleMessage( message );
	}

	waitForInput(): Promise< string > {
		return this.ui.waitForInput();
	}

	askUser( questions: AskUserQuestion[] ): Promise< Record< string, string > > {
		return this.ui.askUser( questions );
	}

	openActiveSiteInBrowser(): Promise< boolean > {
		return this.ui.openActiveSiteInBrowser();
	}
}

export class JsonAdapter implements AiOutputAdapter {
	currentProvider: AiProviderId = 'wpcom';
	currentModel: AiModelId = 'claude-sonnet-4-6';
	activeSite: SiteInfo | null = null;
	onSiteSelected: ( ( site: SiteInfo ) => void ) | null = null;
	onInterrupt: ( () => void ) | null = null;

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

	showInfo( message: string ): void {
		emitEvent( { type: 'info', timestamp: new Date().toISOString(), message } );
	}

	showError( message: string ): void {
		emitEvent( { type: 'error', timestamp: new Date().toISOString(), message } );
	}

	setStatusMessage(): void {
		// No-op in JSON mode
	}

	setLoaderMessage( message: string ): void {
		emitEvent( { type: 'progress', timestamp: new Date().toISOString(), message } );
	}

	beginAgentTurn(): void {
		emitEvent( { type: 'turn.started', timestamp: new Date().toISOString() } );
	}

	endAgentTurn(): void {
		// turn.completed is emitted separately with status and usage
	}

	addUserMessage(): void {
		// No-op in JSON mode — the service already knows the message it sent
	}

	handleMessage( message: SDKMessage ): HandleMessageResult | undefined {
		emitEvent( { type: 'message', timestamp: new Date().toISOString(), message } );

		if ( message.type === 'result' ) {
			if ( message.subtype === 'success' ) {
				this.sessionId = message.session_id;
				return { sessionId: message.session_id, success: true };
			}
			if ( message.subtype === 'error_max_turns' ) {
				this.sessionId = message.session_id;
				return {
					sessionId: message.session_id,
					maxTurnsReached: true,
					numTurns: message.num_turns,
					costUsd: message.total_cost_usd,
				};
			}
			this.sessionId = message.session_id;
			return { sessionId: message.session_id, success: false };
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

	askUser( questions: AskUserQuestion[] ): Promise< Record< string, string > > {
		emitEvent( {
			type: 'question.asked',
			timestamp: new Date().toISOString(),
			questions: questions.map( ( q ) => ( {
				question: q.question,
				options: q.options,
			} ) ),
		} );
		this.emitTurnCompleted( 'paused' );
		process.exit( 0 );

		// Unreachable, but satisfies TypeScript
		return Promise.resolve( {} );
	}

	openActiveSiteInBrowser(): Promise< boolean > {
		throw new Error( 'openActiveSiteInBrowser is not available in JSON mode' );
	}
}
