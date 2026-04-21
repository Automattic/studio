import {
	filterEventsAfterLastClear,
	isVisibleUserMessage,
} from '@studio/common/ai/sessions/filter-events';
import { AiChatUI } from 'cli/ai/ui';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AiSessionEvent } from '@studio/common/ai/sessions/types';

export function replaySessionHistory( ui: AiChatUI, events: AiSessionEvent[] ): void {
	ui.prepareForReplay();
	let isTurnOpen = false;

	const eventsToReplay = filterEventsAfterLastClear( events );

	try {
		for ( const event of eventsToReplay ) {
			ui.setReplayTimestamp( event.timestamp );

			if ( event.type === 'site.selected' ) {
				ui.setActiveSite(
					{
						name: event.siteName,
						path: event.sitePath,
						running: false,
						remote: event.remote === true,
						url: typeof event.url === 'string' ? event.url : undefined,
						wpcomSiteId: typeof event.wpcomSiteId === 'number' ? event.wpcomSiteId : undefined,
					},
					{ announce: true, emitEvent: false }
				);
				continue;
			}

			if ( event.type === 'environment.selected' ) {
				// Legacy event emitted briefly by the apps/ui environment
				// switcher. It toggled the environment without restating the
				// site — keep name/path from the prior `site.selected` and
				// only adjust the remote bits so pre-migration sessions still
				// resume into the right environment.
				const current = ui.activeSite;
				if ( ! current ) {
					continue;
				}
				const isLive = event.environment === 'live';
				ui.setActiveSite(
					{
						name: current.name,
						path: current.path,
						running: current.running,
						remote: isLive,
						url: isLive ? event.url : undefined,
						wpcomSiteId: isLive ? event.wpcomSiteId : undefined,
					},
					{ announce: true, emitEvent: false }
				);
				continue;
			}

			if ( event.type === 'user.message' ) {
				if ( ! isVisibleUserMessage( event ) ) {
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
				ui.handleMessage( event.message as SDKMessage );
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
