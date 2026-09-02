import { formatAiCreditsAddedTitle } from '@studio/common/lib/studio-assistant-quota';
import { __ } from '@wordpress/i18n';
import { close } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { useAppDispatch, useI18nLocale, useRootSelector } from 'src/stores';
import { selectAiCreditsAdded, setAiCreditsAdded } from 'src/stores/ui-slice';

/**
 * Confirms a top-up above the Classic composer once the balance has grown.
 * The agentic UI says the same thing in a toast; Classic has no toast surface,
 * so it borrows the card treatment of the out-of-credits notice beside it. It
 * leaves like a toast too, on a clock the listener starts at confirmation.
 */
export function AiCreditsPurchasedNotice() {
	const dispatch = useAppDispatch();
	const locale = useI18nLocale();
	const creditsAdded = useRootSelector( selectAiCreditsAdded );

	if ( creditsAdded === null ) {
		return null;
	}

	return (
		<div className="border-frame-border bg-frame-surface relative mb-2 flex flex-col items-start gap-1 rounded-lg border p-3 text-left">
			<span className="text-frame-text pe-6 text-sm font-semibold">
				{ formatAiCreditsAddedTitle( creditsAdded, locale ) }
			</span>
			<button
				type="button"
				aria-label={ __( 'Dismiss' ) }
				onClick={ () => dispatch( setAiCreditsAdded( null ) ) }
				className="text-frame-text-secondary hover:text-frame-text absolute end-2 top-2"
			>
				<Icon icon={ close } size={ 16 } />
			</button>
		</div>
	);
}
