import {
	ADD_AI_CREDITS_URL,
	formatAiAccessRequiredNotice,
	formatAiBlockedNotice,
	formatOutOfCreditsNoticeWithLink,
	STUDIO_CODE_AI_BETA_APPLY_URL,
	WPCOM_SUPPORT_CONTACT_URL,
	type StudioAssistantQuota,
} from '@studio/common/lib/studio-assistant-quota';
import { createInterpolateElement } from '@wordpress/element';
import Button from 'src/components/button';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { ReactNode } from 'react';

function NoticeLink( { url, children }: { url: string; children?: ReactNode } ) {
	return (
		<Button variant="link" onClick={ () => getIpcApi().openURL( url ) }>
			{ children }
		</Button>
	);
}

export function AiAccessRequiredNotice( {
	quota,
}: {
	quota?: Pick< StudioAssistantQuota, 'costUsage' > | null;
} ) {
	return createInterpolateElement( formatAiAccessRequiredNotice( quota ), {
		applyLink: <NoticeLink url={ STUDIO_CODE_AI_BETA_APPLY_URL } />,
	} );
}

export function AiBlockedNotice() {
	return createInterpolateElement( formatAiBlockedNotice(), {
		supportLink: <NoticeLink url={ WPCOM_SUPPORT_CONTACT_URL } />,
	} );
}

export function OutOfCreditsNotice() {
	return createInterpolateElement( formatOutOfCreditsNoticeWithLink(), {
		buyLink: <NoticeLink url={ ADD_AI_CREDITS_URL } />,
	} );
}
