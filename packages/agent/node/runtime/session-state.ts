import { createBlockValidationGate } from '@studio/agent/node/block-validation-gate';
import { createOpenProblems } from '@studio/agent/node/open-problems';
import { RenderCheck } from '@studio/agent/node/render-check';
import { PendingWork } from './pending-work';
import { Writers } from './writers';
import type { BlockValidationGate } from '@studio/agent/node/block-validation-gate';
import type { StudioAgentHost } from '@studio/agent/node/host';
import type { OpenProblems } from '@studio/agent/node/open-problems';

/**
 * What Studio keeps of a chat session across its turns: the problems open on
 * its sites, the work its tools left running, its block files' validation,
 * and the render of the pages it changed. Each turn's checks report into it,
 * so what one finds reaches the agent on a later call, in that turn or the next.
 */
export interface SessionState {
	openProblems: OpenProblems;
	pendingWork: PendingWork;
	blockValidation: BlockValidationGate;
	renderCheck: RenderCheck;
	// Which of the agents writing to the sites at once wrote what.
	writers: Writers;
}

const states = new WeakMap< object, SessionState >();

/** The state of the chat session `session`, made on its first turn. */
export function getSessionState( host: StudioAgentHost, session: object ): SessionState {
	let state = states.get( session );
	if ( ! state ) {
		const openProblems = createOpenProblems( host );
		const pendingWork = new PendingWork();
		state = {
			openProblems,
			pendingWork,
			writers: new Writers( pendingWork ),
			blockValidation: createBlockValidationGate( host, openProblems ),
			renderCheck: new RenderCheck( host, openProblems ),
		};
		states.set( session, state );
	}
	return state;
}

/**
 * The state of a subagent's session `session`: its parent session's problems,
 * validations, render and writers, so each finding reaches the agent that
 * wrote what it is about, and the work its own tools leave running.
 */
export function shareSessionState( session: object, parent: SessionState ): SessionState {
	const state = { ...parent, pendingWork: new PendingWork() };
	states.set( session, state );
	return state;
}
