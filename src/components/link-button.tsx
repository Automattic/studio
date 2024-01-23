import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cx } from '../cx';

export default forwardRef< HTMLButtonElement, ButtonHTMLAttributes< HTMLButtonElement > >(
	function LinkButton( { type = 'button', className, ...rest }, ref ) {
		return (
			<button
				ref={ ref }
				type={ type }
				className={ cx( 'flex gap-1 underline disabled:opacity-30', className ) }
				{ ...rest }
			/>
		);
	}
);
