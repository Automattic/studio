import { formatAiCreditsAddedTitle } from '@studio/common/lib/studio-assistant-quota';
import { ThemeProvider } from '@wordpress/theme';
import { Notice } from '@wordpress/ui';
import { useFrameBackgroundColor } from 'src/hooks/use-frame-background-color';
import { useAppDispatch, useI18nLocale, useRootSelector } from 'src/stores';
import { selectAiCreditsAdded, setAiCreditsAdded } from 'src/stores/ui-slice';
import buttonDefense from './studio-code-session/wp-ui-button-defense.module.css';

/**
 * Confirms a top-up above the Classic composer once the balance has grown.
 * The agentic UI says the same thing in a toast; Classic has no toast surface,
 * so it uses the design system's Notice. It leaves like a toast too, on a
 * clock the listener starts at confirmation.
 *
 * The nested `ThemeProvider` is what makes the Notice follow dark mode: its
 * colors come from `--wpds-color-*`, which are light-only until the theme gets
 * a background seed. Scoped to this notice rather than to all of Studio Code,
 * because seeding higher up restyles every WPDS component under it.
 */
export function AiCreditsPurchasedNotice() {
	const dispatch = useAppDispatch();
	const locale = useI18nLocale();
	const creditsAdded = useRootSelector( selectAiCreditsAdded );
	const frameBackgroundColor = useFrameBackgroundColor();

	if ( creditsAdded === null ) {
		return null;
	}

	return (
		<ThemeProvider color={ { background: frameBackgroundColor } }>
			<Notice.Root intent="success" className="mb-2">
				<Notice.Title>{ formatAiCreditsAddedTitle( creditsAdded, locale ) }</Notice.Title>
				<Notice.CloseIcon
					className={ buttonDefense.button }
					onClick={ () => dispatch( setAiCreditsAdded( null ) ) }
				/>
			</Notice.Root>
		</ThemeProvider>
	);
}
