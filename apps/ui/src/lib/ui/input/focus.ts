import type { DOMAttributes } from 'react';

export function inputFocusHandlers< T extends HTMLInputElement | HTMLTextAreaElement >(
	props: Pick< DOMAttributes< T >, 'onPointerDown' | 'onBlur' >
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
	};
}
