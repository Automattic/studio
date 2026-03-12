import path from 'path';
import { AiChatUI } from 'cli/ai/ui';
import type { AiSessionEvent } from './types';

export function replaySessionHistory( ui: AiChatUI, events: AiSessionEvent[] ): void {
	ui.prepareForReplay();

	try {
		for ( const event of events ) {
			ui.setReplayTimestamp( event.timestamp );

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
				if ( event.source === 'ask_user' ) {
					continue;
				}

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
				ui.beginAgentTurn();
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
				ui.endAgentTurn();
			}
		}
	} finally {
		ui.finishReplay();
	}
}
