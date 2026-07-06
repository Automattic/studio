// Rehydrate the terminal UI from a session's JSONL on resume. Walks
// `SessionEntry[]` and dispatches each entry to the live `ui.handleEvent()`
// path (for assistant messages) or directly to `ui.*` (for Studio's
// `custom` markers — site selections, agent questions — which
// don't appear in pi's flat `buildSessionContext()` output).

import { isStudioCustomEntryOfType } from '@studio/common/ai/sessions/entry-types';
import { AiChatUI } from 'cli/ai/ui';
import type { ToolResultMessage } from '@earendil-works/pi-ai';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { StudioPermissionRequestData } from '@studio/common/ai/sessions/entry-types';
import type { PermissionDecision } from '@studio/common/ai/tool-permissions';

export function replaySessionHistory( ui: AiChatUI, entries: SessionEntry[] ): void {
	ui.prepareForReplay();

	let isTurnOpen = false;
	let pendingResults: ToolResultMessage[] = [];
	const flushPendingResults = () => {
		if ( pendingResults.length === 0 ) return;
		ui.renderToolResults( pendingResults );
		pendingResults = [];
	};

	// Permission requests pair with their response by id; a request whose
	// response never landed (process died while waiting) renders as expired.
	let pendingPermission: StudioPermissionRequestData | null = null;
	const flushPendingPermission = ( decision?: PermissionDecision ) => {
		if ( ! pendingPermission ) return;
		ui.showPermissionRequest( pendingPermission, decision );
		pendingPermission = null;
	};

	try {
		for ( const entry of entries ) {
			ui.setReplayTimestamp( entry.timestamp );

			if ( isStudioCustomEntryOfType( entry, 'studio.site_selected' ) ) {
				const data = entry.data;
				if ( data ) {
					ui.setActiveSite(
						{
							name: data.siteName,
							path: data.sitePath,
							running: false,
							remote: data.remote === true,
							url: data.url,
							wpcomSiteId: data.wpcomSiteId,
						},
						{ announce: true, emitEvent: false }
					);
				}
				continue;
			}

			if ( isStudioCustomEntryOfType( entry, 'studio.user_prompt' ) ) {
				const data = entry.data;
				if ( ! data || data.source !== 'prompt' ) continue;
				if ( isTurnOpen ) {
					flushPendingResults();
					ui.endAgentTurn();
				}
				ui.beginAgentTurn();
				isTurnOpen = true;
				ui.addUserMessage( data.text );
				continue;
			}

			if ( isStudioCustomEntryOfType( entry, 'studio.tool_progress' ) ) {
				// Tool progress is ephemeral UI state (loader text) with no value
				// when rehydrating history: `finishReplay()` clears the loader at
				// the end anyway. Replaying it one entry at a time is the bottleneck
				// behind the "Resuming session…" hang on sessions that persisted
				// tens of thousands of progress ticks, so skip it during replay.
				// See https://github.com/Automattic/studio/issues/3865
				continue;
			}

			if ( isStudioCustomEntryOfType( entry, 'studio.agent_question' ) ) {
				if ( entry.data ) ui.showAgentQuestion( entry.data.question, entry.data.options );
				continue;
			}

			if ( isStudioCustomEntryOfType( entry, 'studio.permission_request' ) ) {
				flushPendingPermission();
				pendingPermission = entry.data ?? null;
				continue;
			}

			if ( isStudioCustomEntryOfType( entry, 'studio.permission_response' ) ) {
				if ( pendingPermission && entry.data && entry.data.id === pendingPermission.id ) {
					flushPendingPermission( entry.data.decision );
				} else {
					flushPendingPermission();
				}
				continue;
			}

			if ( isStudioCustomEntryOfType( entry, 'studio.turn_closed' ) ) {
				flushPendingResults();
				if ( isTurnOpen ) {
					ui.endAgentTurn();
					isTurnOpen = false;
				}
				continue;
			}

			if ( entry.type === 'message' ) {
				const message = entry.message;
				if ( message.role === 'assistant' ) {
					flushPendingResults();
					ui.handleEvent( { type: 'message_end', message } );
				} else if ( message.role === 'toolResult' ) {
					pendingResults.push( message );
				}
			}
		}
		flushPendingResults();
		flushPendingPermission();
	} finally {
		if ( isTurnOpen ) {
			ui.endAgentTurn();
		}
		ui.finishReplay();
	}
}
