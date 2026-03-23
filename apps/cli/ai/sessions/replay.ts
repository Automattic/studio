import { AiChatUI } from 'cli/ai/ui';
import type { AiSessionEvent } from './types';

export function replaySessionHistory( ui: AiChatUI, events: AiSessionEvent[] ): void {
	ui.prepareForReplay();
	let isTurnOpen = false;

	try {
		for ( const event of events ) {
			ui.setReplayTimestamp( event.timestamp );

			if ( event.type === 'site.selected' ) {
				ui.setActiveSite(
					{
						name: event.siteName,
						path: event.sitePath,
						running: false,
						remote: event.remote === true,
						url: typeof event.url === 'string' ? event.url : undefined,
					},
					{ announce: true, emitEvent: false }
				);
				continue;
			}

			if ( event.type === 'user.message' ) {
				if ( event.source === 'ask_user' ) {
					continue;
				}

				// Defensive close if the previous turn never emitted turn.closed.
				if ( isTurnOpen ) {
					ui.endAgentTurn();
				}

				ui.beginAgentTurn();
				isTurnOpen = true;
				ui.addUserMessage( event.text );
				continue;
			}

			if ( event.type === 'sdk.message' ) {
				ui.handleMessage( event.message );
				continue;
			}

			if ( event.type === 'tool.progress' ) {
				ui.setLoaderMessage( event.message );
				continue;
			}

			if ( event.type === 'agent.question' ) {
				ui.showAgentQuestion( event.question, event.options );
				continue;
			}

			if ( event.type === 'turn.closed' ) {
				if ( isTurnOpen ) {
					ui.endAgentTurn();
					isTurnOpen = false;
				}
			}
		}
	} finally {
		if ( isTurnOpen ) {
			ui.endAgentTurn();
		}
		ui.finishReplay();
	}
}
