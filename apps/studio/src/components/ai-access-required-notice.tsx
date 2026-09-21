import {
	formatAiAccessRequiredNotice,
	formatAiBlockedNotice,
	formatOutOfCreditsDescription,
	formatOutOfCreditsTitle,
	STUDIO_CODE_AI_BETA_APPLY_URL,
	WPCOM_SUPPORT_CONTACT_URL,
	type StudioAssistantQuota,
} from '@studio/common/lib/studio-assistant-quota';
import { createInterpolateElement } from '@wordpress/element';
import { AddAiCreditsButton } from 'src/components/add-ai-credits-button';
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

/**
 * Running out of credits isn't a failure to report, it's a purchase to make —
 * so it reads as a card with the action in it rather than as red error text.
 */
export function OutOfCreditsNotice() {
	return (
		<div className="border-frame-border bg-frame-surface flex flex-col items-start gap-1 rounded-lg border p-3 text-left">
			<span className="text-frame-text text-sm font-semibold">{ formatOutOfCreditsTitle() }</span>
			<span className="text-frame-text-secondary text-xs">{ formatOutOfCreditsDescription() }</span>
			<AddAiCreditsButton className="mt-2" variant="primary" />
		</div>
	);
}
