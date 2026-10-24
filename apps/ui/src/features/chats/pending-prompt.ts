import { createPendingSlot } from '@/lib/pending-slot';
import type { ComposerSendAttachments } from '@studio/common/ai/composer-attachments';

interface PendingPrompt {
	sessionId: string;
	prompt: string;
	attachments: ComposerSendAttachments;
}

export const pendingPromptSlot = createPendingSlot< PendingPrompt >();
