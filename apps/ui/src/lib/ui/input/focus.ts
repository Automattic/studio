import type { DOMAttributes } from 'react';

export function inputFocusHandlers< T extends HTMLInputElement | HTMLTextAreaElement >(
	props: Pick< DOMAttributes< T >, 'onPointerDown' | 'onBlur' | 'onKeyDown' >
) {
	return {
		onPointerDown: ( event: React.PointerEvent< T > ) => {
			event.currentTarget.dataset.pointerFocus = '';
			props.onPointerDown?.( event );
		},
		onBlur: ( event: React.FocusEvent< T > ) => {
			delete event.currentTarget.dataset.pointerFocus;
			props.onBlur?.( event );
		},
		onKeyDown: ( event: React.KeyboardEvent< T > ) => {
			if ( event.key === 'Tab' ) delete event.currentTarget.dataset.pointerFocus;
			props.onKeyDown?.( event );
		},
	};
}
