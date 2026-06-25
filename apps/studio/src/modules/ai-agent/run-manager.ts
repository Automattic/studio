import { createAgentRunManager } from '@studio/common/ai/sessions/run-manager';
import { getBundledNodeBinaryPath, getCliPath } from 'src/storage/paths';
import type { ActiveAgentRun } from '@studio/common/ai/agent-events';
import type { StudioChatFileAttachment } from '@studio/common/ai/chat-files';
import type { StudioChatImage } from '@studio/common/ai/chat-images';
import type { WebContents } from 'electron';

/**
 * Desktop binding for the shared agent run-manager
 * (`@studio/common/ai/sessions/run-manager`). The fork, lifecycle, stats,
 * placement, and error reporting all live in the shared core; this module only
 * supplies the desktop's two host specifics — the bundled CLI/Node binaries and
 * the IPC transport — plus per-window routing. The `studio ui` server wires the
 * same core to SSE instead.
 */

// The renderer that started each run, so events route back to the right window.
const sessionWebContents = new Map< string, WebContents >();

const runManager = createAgentRunManager( {
	cliBinary: getCliPath(),
	nodeBinary: getBundledNodeBinaryPath(),
	surface: 'desktop',
	emit: ( output ) => {
		const webContents = sessionWebContents.get( output.event.sessionId );
		if ( webContents && ! webContents.isDestroyed() ) {
			if ( output.kind === 'agent' ) {
				webContents.send( 'ai-agent-event', output.event );
			} else {
				webContents.send( 'ai-session-placement-updated', output.event );
			}
		}
		// The run is over once it exits; drop the mapping so a destroyed window
		// doesn't linger.
		if ( output.kind === 'agent' && output.event.event.type === 'run.exited' ) {
			sessionWebContents.delete( output.event.sessionId );
		}
	},
} );

export interface StartAgentRunOptions {
	sessionId: string;
	prompt: string;
	displayMessage?: string;
	images?: StudioChatImage[];
	files?: StudioChatFileAttachment[];
	webContents: WebContents;
}

export function startAgentRun( options: StartAgentRunOptions ): { runId: string } {
	const { sessionId, prompt, displayMessage, images, files, webContents } = options;
	// Route this session's events to the originating window before the run can
	// emit anything (the child's first event is async, on the next tick).
	sessionWebContents.set( sessionId, webContents );
	try {
		const result = runManager.startAgentRun( { sessionId, prompt, displayMessage, images, files } );
		// Abort the run if the window that started it goes away.
		webContents.once( 'destroyed', () => runManager.interruptAgentRun( result.runId ) );
		return result;
	} catch ( error ) {
		// Concurrent-run rejection (or any synchronous failure): undo the routing.
		sessionWebContents.delete( sessionId );
		throw error;
	}
}

export function listActiveAgentRuns(): ActiveAgentRun[] {
	return runManager.listActiveAgentRuns();
}

export function interruptAgentRun( runId: string ): void {
	runManager.interruptAgentRun( runId );
}

export function answerAgentRun( runId: string, answers: Record< string, string > ): void {
	runManager.answerAgentRun( runId, answers );
}
