import path from 'path';
import { AiChatUI } from 'cli/ai/ui';
import { toReplayAssistantMessage, toReplayToolResultMessage } from './parser';
import type { AiSessionEvent } from './types';

export function replaySessionHistory( ui: AiChatUI, events: AiSessionEvent[] ): void {
	ui.prepareForReplay();

	try {
		for ( const event of events ) {
			if ( event.type === 'site.selected' ) {
				ui.setActiveSite(
					{
						name: event.siteName,
						path: event.sitePath,
						running: false,
					},
					{ announce: false, emitEvent: false }
				);
				continue;
			}

			if ( event.type === 'user.message' ) {
				if ( event.sitePath && ( ! ui.activeSite || ui.activeSite.path !== event.sitePath ) ) {
					ui.setActiveSite(
						{
							name: path.basename( event.sitePath ),
							path: event.sitePath,
							running: false,
						},
						{ announce: false, emitEvent: false }
					);
				}
				ui.addUserMessage( event.text );
				continue;
			}

			if ( event.type === 'assistant.message' ) {
				ui.handleMessage( toReplayAssistantMessage( event.blocks ) );
				continue;
			}

			if ( event.type === 'tool.result' ) {
				ui.handleMessage( toReplayToolResultMessage( event ) );
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
				ui.endAgentTurn();
			}
		}
	} finally {
		ui.finishReplay();
	}
}
