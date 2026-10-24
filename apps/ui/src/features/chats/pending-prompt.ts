import { createPendingSlot } from '@/lib/utils';
import type { ComposerSendAttachments } from '@studio/common/ai/composer-attachments';

interface PendingPrompt {
	sessionId: string;
	prompt: string;
	attachments: ComposerSendAttachments;
}

export const pendingPromptSlot = createPendingSlot< PendingPrompt >();
