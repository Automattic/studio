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
import { Notice } from '@wordpress/ui';
import { AddAiCreditsButton } from '@/components/add-ai-credits-button';
import { useConnector } from '@/data/core';
import styles from './style.module.css';
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

/**
 * Running out of credits isn't a failure to report, it's a purchase to make —
 * so it reads as a card with the action in it rather than as red error text.
 */
export function OutOfCreditsNotice() {
	return (
		<Notice.Root intent="neutral" icon={ null } className={ styles.outOfCredits }>
			<Notice.Title>{ formatOutOfCreditsTitle() }</Notice.Title>
			<Notice.Description>{ formatOutOfCreditsDescription() }</Notice.Description>
			<Notice.Actions>
				<AddAiCreditsButton variant="solid" tone="brand" />
			</Notice.Actions>
		</Notice.Root>
	);
}
