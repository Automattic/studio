import { type ButtonHTMLAttributes } from 'react';
import { cx } from '../cx';

export default function LinkButton( {
	type = 'button',
	className,
	...rest
}: ButtonHTMLAttributes< HTMLButtonElement > ) {
	return <button type={ type } className={ cx( 'underline', className ) } { ...rest } />;
}
