import { useCallback } from 'react';
import type { KeyboardEvent } from 'react';

// Controls that give Enter a meaning of their own. Checkboxes and radios are
// deliberately absent: Enter does nothing for them natively, so letting it
// reach the dialog's default action is what makes "tick the box, press Return"
// work. A dialog that grows a text field gets the standard treatment instead —
// Enter stays with the field.
const SELF_HANDLING_KEY = [
	'button',
	'a[href]',
	'textarea',
	'select',
	'[contenteditable=""]',
	'[contenteditable="true"]',
	'input:not([type="checkbox"]):not([type="radio"])',
].join( ',' );

/**
 * Makes Return activate a dialog's confirm button from anywhere inside it,
 * the way a default button behaves on macOS.
 *
 * The button is found by its label because the wpds `AlertDialog` renders its
 * own footer — we hand it `confirmButtonText` but never see the element. A
 * missed match therefore does nothing rather than firing the wrong action.
 *
 * Returns a `keydown` handler for the dialog's `Popup`.
 */
export function useConfirmOnEnter( confirmLabel: string ) {
	return useCallback(
		( event: KeyboardEvent< HTMLElement > ) => {
			if ( event.key !== 'Enter' || event.defaultPrevented ) {
				return;
			}
			// A held Return that opened this dialog would otherwise auto-repeat
			// straight into confirming it.
			if ( event.repeat ) {
				return;
			}
			if ( event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ) {
				return;
			}
			if ( ( event.target as HTMLElement | null )?.closest( SELF_HANDLING_KEY ) ) {
				return;
			}

			const confirm = Array.from(
				event.currentTarget.querySelectorAll< HTMLButtonElement >( 'button' )
			).find( ( button ) => button.textContent?.trim() === confirmLabel );

			if ( ! confirm || confirm.disabled || confirm.getAttribute( 'aria-disabled' ) === 'true' ) {
				return;
			}

			event.preventDefault();
			confirm.click();
		},
		[ confirmLabel ]
	);
}
