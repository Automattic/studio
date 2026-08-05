import {
	formatAiAccessRequiredNotice,
	STUDIO_CODE_AI_BETA_APPLY_URL,
	type StudioAssistantQuota,
} from '@studio/common/lib/studio-assistant-quota';
import { createInterpolateElement } from '@wordpress/element';
import { useConnector } from '@/data/core';

export function AiAccessRequiredNotice( {
	quota,
}: {
	quota?: Pick< StudioAssistantQuota, 'costUsage' > | null;
} ) {
	const connector = useConnector();
	return createInterpolateElement( formatAiAccessRequiredNotice( quota ), {
		applyLink: (
			// Electron swallows plain `target="_blank"` navigations — route
			// clicks through the connector so the link opens in the system
			// browser.
			<a
				href={ STUDIO_CODE_AI_BETA_APPLY_URL }
				target="_blank"
				rel="noreferrer noopener"
				onClick={ ( event ) => {
					event.preventDefault();
					void connector.openExternalUrl( STUDIO_CODE_AI_BETA_APPLY_URL );
				} }
			/>
		),
	} );
}
