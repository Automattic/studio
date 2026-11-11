import { createPendingSlot } from '@/lib/pending-slot';
import type { ComposerSendAttachments } from '@studio/agent/protocol/composer-attachments';

interface PendingPrompt {
	sessionId: string;
	prompt: string;
	attachments: ComposerSendAttachments;
}

export const pendingPromptSlot = createPendingSlot< PendingPrompt >();
