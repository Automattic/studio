import { __ } from '@wordpress/i18n';
import type { AiSessionSummary } from '@/data/core';

export function getSessionTitle( session: AiSessionSummary ): string {
	const title = session.title?.trim() || session.firstPrompt?.trim() || __( 'New chat' );
	return title.charAt( 0 ).toLocaleUpperCase() + title.slice( 1 );
}
