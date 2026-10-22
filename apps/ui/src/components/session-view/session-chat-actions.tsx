import { __ } from '@wordpress/i18n';
import type { AiSessionSummary } from '@/data/core';

export function getSessionTitle( session: AiSessionSummary ): string {
	return session.title?.trim() || session.firstPrompt?.trim() || __( 'Untitled chat' );
}
