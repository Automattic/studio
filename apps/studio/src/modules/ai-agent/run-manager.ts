import { createAgentRunManager } from '@studio/common/ai/run-manager';
import { getBundledNodeBinaryPath, getCliPath } from 'src/storage/paths';
import type { ActiveAgentRun } from '@studio/common/ai/agent-events';
import type { StudioChatFileAttachment } from '@studio/common/ai/chat-files';
import type { StudioChatImage } from '@studio/common/ai/chat-images';
import type { PermissionDecision } from '@studio/common/ai/tool-permissions';
import type { WebContents } from 'electron';

/**
 * Desktop binding for the shared agent run-manager
 * (`@studio/common/ai/run-manager`). The fork, lifecycle, stats,
 * placement, and error reporting all live in the shared core; this module only
 * supplies the desktop's two host specifics — the bundled CLI/Node binaries and
 * the IPC transport — plus per-run routing. The `studio ui` server wires the
 * same core to SSE instead.
 */

// The renderer that started each run, keyed by the unique runId so overlapping
// runs on the same session (interrupt-then-restart, or a rejected double-send)
// never clobber each other's routing.
const runWebContents = new Map< string, WebContents >();

const runManager = createAgentRunManager( {
	cliBinary: getCliPath(),
	nodeBinary: getBundledNodeBinaryPath(),
	surface: 'desktop',
	emit: ( output ) => {
		const webContents = runWebContents.get( output.runId );
		const deliverable = !! webContents && ! webContents.isDestroyed();
		// Interaction and lifecycle events are load-bearing for the renderer —
		// log their delivery so a silent drop (destroyed/unmapped webContents)
		// is diagnosable from the log file instead of invisible.
		if ( output.kind === 'agent' ) {
			const type = output.event.event.type;
			if ( type !== 'message' && type !== 'progress' ) {
				console.log(
					`[ai-agent] ${ type } run=${ output.runId } wc=${
						webContents ? `${ webContents.id }${ deliverable ? '' : ':destroyed' }` : 'unmapped'
					}`
				);
			}
		}
		if ( deliverable ) {
			if ( output.kind === 'agent' ) {
				webContents.send( 'ai-agent-event', output.event );
			} else {
				webContents.send( 'ai-session-placement-updated', output.event );
			}
		}
		// The run is over once it exits; drop its mapping so a destroyed window
		// doesn't linger.
		if ( output.kind === 'agent' && output.event.event.type === 'run.exited' ) {
			runWebContents.delete( output.runId );
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
	// `startAgentRun` forks the child and returns its id synchronously; the
	// child's first event arrives async (next tick), so registering the route
	// after a successful start — keyed by the unique runId — is in time, and a
	// rejected start (e.g. a concurrent run on the same session) never touches
	// another run's routing.
	const result = runManager.startAgentRun( { sessionId, prompt, displayMessage, images, files } );
	runWebContents.set( result.runId, webContents );
	// Abort the run if the window that started it goes away.
	webContents.once( 'destroyed', () => runManager.interruptAgentRun( result.runId ) );
	return result;
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

export function answerAgentPermission(
	runId: string,
	requestId: string,
	decision: PermissionDecision
): void {
	runManager.answerAgentPermission( runId, requestId, decision );
}
