import { createPendingSlot } from './pending-slot';

/**
 * One-slot handoff for a prompt that should be sent automatically in the
 * next chat session opened for a site — currently the plugin-creation flow
 * handing the plugin description to the agent so it builds the initial
 * version. Tied to a site id so a stale slot can never fire in an
 * unrelated session.
 */
export interface PendingSessionPrompt {
	siteId: string;
	prompt: string;
}

export const pendingSessionPromptSlot = createPendingSlot< PendingSessionPrompt >();

export const setPendingSessionPrompt = pendingSessionPromptSlot.set;
