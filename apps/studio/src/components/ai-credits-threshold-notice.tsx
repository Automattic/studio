import {
	formatAiCreditsThresholdDescription,
	formatAiCreditsUsageTitle,
	getAiCreditsMeter,
	getAiCreditsMeterIntent,
	getStudioCodeAiAccessState,
	resolveAiCreditsThresholdNotice,
} from '@studio/common/lib/studio-assistant-quota';
import { __ } from '@wordpress/i18n';
import { close } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { useEffect, type ReactNode } from 'react';
import { AddAiCreditsButton } from 'src/components/add-ai-credits-button';
import { useAppDispatch, useI18nLocale, useRootSelector } from 'src/stores';
import { selectDismissedAiCreditsIntent, setDismissedAiCreditsIntent } from 'src/stores/ui-slice';
import { useGetStudioAssistantQuota } from 'src/stores/wpcom-api';

// Classic has no composer strip and no lockout banner of its own, so this one
// slot announces both warning steps. The agentic UI splits them across the
// sidebar and the composer instead.
const CLASSIC_NOTICE_INTENTS = [ 'warning', 'critical' ] as const;

function NoticeCard( {
	title,
	description,
	action,
	onDismiss,
}: {
	title: string;
	description?: string;
	action?: ReactNode;
	onDismiss: () => void;
} ) {
	return (
		<div className="border-frame-border bg-frame-surface relative mb-2 flex flex-col items-start gap-1 rounded-lg border p-3 text-left">
			<span className="text-frame-text pe-6 text-sm font-semibold">{ title }</span>
			{ description ? (
				<span className="text-frame-text-secondary text-xs">{ description }</span>
			) : null }
			{ action }
			<button
				type="button"
				aria-label={ __( 'Dismiss' ) }
				onClick={ onDismiss }
				className="text-frame-text-secondary hover:text-frame-text absolute end-2 top-2"
			>
				<Icon icon={ close } size={ 16 } />
			</button>
		</div>
	);
}

/**
 * Warns above the Classic composer as the AI credit balance runs down. Classic
 * has no persistent-message surface, so the warning sits where the user is
 * about to spend the credits.
 */
export function AiCreditsThresholdNotice() {
	const dispatch = useAppDispatch();
	const locale = useI18nLocale();
	const dismissedIntent = useRootSelector( selectDismissedAiCreditsIntent );
	const { data: quota } = useGetStudioAssistantQuota();
	const meter =
		quota && getStudioCodeAiAccessState( quota ) === 'available'
			? getAiCreditsMeter( quota )
			: null;
	const intent = meter ? getAiCreditsMeterIntent( meter.fraction ) : null;
	const notice = resolveAiCreditsThresholdNotice( intent, dismissedIntent, CLASSIC_NOTICE_INTENTS );

	// Drop a dismissal the current usage has left behind, so the notice can
	// fire again if the account returns to that threshold.
	useEffect( () => {
		if ( notice.dismissedIntent !== dismissedIntent ) {
			dispatch( setDismissedAiCreditsIntent( notice.dismissedIntent ) );
		}
	}, [ dispatch, dismissedIntent, notice.dismissedIntent ] );

	const thresholdIntent = intent === 'warning' || intent === 'critical' ? intent : null;
	if ( ! thresholdIntent || ! notice.visible || ! meter ) {
		return null;
	}

	return (
		<NoticeCard
			title={ formatAiCreditsUsageTitle( meter.fraction, locale ) }
			description={ formatAiCreditsThresholdDescription() }
			action={ <AddAiCreditsButton className="mt-2" /> }
			onDismiss={ () => dispatch( setDismissedAiCreditsIntent( thresholdIntent ) ) }
		/>
	);
}
