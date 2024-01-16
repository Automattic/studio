import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cx } from '../cx';

export default forwardRef< HTMLButtonElement, ButtonHTMLAttributes< HTMLButtonElement > >(
	function LinkButton( { type = 'button', className, ...rest }, ref ) {
		return (
			<button ref={ ref } type={ type } className={ cx( 'underline', className ) } { ...rest } />
		);
	}
);
