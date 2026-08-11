import { createPendingSlot } from './pending-slot';
import type { StudioChatFileAttachment, StudioChatImage } from '@/data/core';

/**
 * One-slot handoff for a prompt that should be sent automatically in the
 * next chat session opened for a site — the plugin-creation flow handing
 * the plugin description to the agent, and the onboarding AI brief doing
 * the same for a first site. Tied to a site id so a stale slot can never
 * fire in an unrelated session.
 */
export interface PendingSessionPrompt {
	siteId: string;
	prompt: string;
	images?: StudioChatImage[];
	files?: StudioChatFileAttachment[];
}

export const pendingSessionPromptSlot = createPendingSlot< PendingSessionPrompt >();

export const setPendingSessionPrompt = pendingSessionPromptSlot.set;
