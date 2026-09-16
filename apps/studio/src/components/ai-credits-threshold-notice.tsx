import {
	formatAiCreditsThresholdDescription,
	formatAiCreditsUsageTitle,
	getAiCreditsMeter,
	getAiCreditsMeterIntent,
	getStudioCodeAiAccessState,
	resolveAiCreditsThresholdNotice,
} from '@studio/common/lib/studio-assistant-quota';
import { __ } from '@wordpress/i18n';
import { ThemeProvider } from '@wordpress/theme';
import { Notice } from '@wordpress/ui';
import { useEffect } from 'react';
import { AddAiCreditsButton } from 'src/components/add-ai-credits-button';
import { useFrameBackgroundColor } from 'src/hooks/use-frame-background-color';
import { useAppDispatch, useI18nLocale, useRootSelector } from 'src/stores';
import { selectDismissedAiCreditsIntent, setDismissedAiCreditsIntent } from 'src/stores/ui-slice';
import { useGetStudioAssistantQuota } from 'src/stores/wpcom-api';
import buttonDefense from './studio-code-session/wp-ui-button-defense.module.css';

// Classic has no composer strip and no lockout banner of its own, so this one
// slot announces both warning steps. The agentic UI splits them across the
// sidebar and the composer instead.
const CLASSIC_NOTICE_INTENTS = [ 'warning', 'critical' ] as const;

/**
 * Warns above the Classic composer as the AI credit balance runs down. Classic
 * has no persistent-message surface, so the warning sits where the user is
 * about to spend the credits.
 *
 * The nested `ThemeProvider` is what makes the Notice follow dark mode, on the
 * same terms as {@link AiCreditsPurchasedNotice}.
 */
export function AiCreditsThresholdNotice() {
	const dispatch = useAppDispatch();
	const locale = useI18nLocale();
	const frameBackgroundColor = useFrameBackgroundColor();
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

	const title = formatAiCreditsUsageTitle( meter.fraction, locale );
	const description = formatAiCreditsThresholdDescription();

	return (
		<ThemeProvider color={ { background: frameBackgroundColor } }>
			<Notice.Root
				intent="warning"
				// Announcing the rendered children would run the purchase
				// dialog through renderToString, which fails silently and
				// leaves nothing spoken. The two lines of copy are the message.
				spokenMessage={ `${ title } ${ description }` }
				className="mb-2"
			>
				<Notice.Title>{ title }</Notice.Title>
				<Notice.Description>{ description }</Notice.Description>
				<Notice.Actions>
					<AddAiCreditsButton />
				</Notice.Actions>
				<Notice.CloseIcon
					label={ __( 'Dismiss' ) }
					className={ buttonDefense.button }
					onClick={ () => dispatch( setDismissedAiCreditsIntent( thresholdIntent ) ) }
				/>
			</Notice.Root>
		</ThemeProvider>
	);
}
