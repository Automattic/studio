import type { DOMAttributes } from 'react';

export function inputFocusHandlers< T extends HTMLInputElement | HTMLTextAreaElement >(
	props: Pick< DOMAttributes< T >, 'onPointerDown' | 'onClick' | 'onBlur' >
) {
	return {
		onPointerDown: ( event: React.PointerEvent< T > ) => {
			event.currentTarget.dataset.pointerFocus = '';
			props.onPointerDown?.( event );
		},
		onClick: ( event: React.MouseEvent< T > ) => {
			if ( event.detail > 0 ) event.currentTarget.dataset.pointerFocus = '';
			props.onClick?.( event );
		},
		onBlur: ( event: React.FocusEvent< T > ) => {
			delete event.currentTarget.dataset.pointerFocus;
			props.onBlur?.( event );
		},
	};
}
