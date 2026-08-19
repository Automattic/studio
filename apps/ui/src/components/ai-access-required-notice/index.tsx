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
import { useConnector } from '@/data/core';
import type { ReactNode } from 'react';

// Electron swallows plain `target="_blank"` navigations — route clicks
// through the connector so the link opens in the system browser.
function NoticeLink( { url, children }: { url: string; children?: ReactNode } ) {
	const connector = useConnector();
	return (
		<a
			href={ url }
			target="_blank"
			rel="noreferrer noopener"
			onClick={ ( event ) => {
				event.preventDefault();
				void connector.openExternalUrl( url );
			} }
		>
			{ children }
		</a>
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

// Both AI credit pools are empty (STU-2236); buying credits is the fix, so
// the notice links straight to the checkout.
export function OutOfCreditsNotice() {
	return createInterpolateElement( formatOutOfCreditsNoticeWithLink(), {
		buyLink: <NoticeLink url={ ADD_AI_CREDITS_URL } />,
	} );
}
