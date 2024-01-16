import { type ButtonHTMLAttributes } from 'react';
import { cx } from '../cx';

export default function Button( {
	type = 'button',
	className,
	...rest
}: ButtonHTMLAttributes< HTMLButtonElement > ) {
	return (
		<button
			type={ type }
			className={ cx(
				'mt-3 inline-flex justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:mt-0 sm:w-auto',
				className
			) }
			{ ...rest }
		/>
	);
}
