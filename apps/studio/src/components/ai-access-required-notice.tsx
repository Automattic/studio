import {
	formatAiAccessRequiredNotice,
	STUDIO_CODE_AI_BETA_APPLY_URL,
	type StudioAssistantQuota,
} from '@studio/common/lib/studio-assistant-quota';
import { createInterpolateElement } from '@wordpress/element';
import Button from 'src/components/button';
import { getIpcApi } from 'src/lib/get-ipc-api';

export function AiAccessRequiredNotice( {
	quota,
}: {
	quota?: Pick< StudioAssistantQuota, 'costUsage' > | null;
} ) {
	return createInterpolateElement( formatAiAccessRequiredNotice( quota ), {
		applyLink: (
			<Button
				variant="link"
				onClick={ () => getIpcApi().openURL( STUDIO_CODE_AI_BETA_APPLY_URL ) }
			/>
		),
	} );
}
