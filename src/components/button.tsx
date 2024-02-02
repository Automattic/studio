import { Button } from '@wordpress/components';
import { ComponentProps } from 'react';
import { cx } from '../lib/cx';

export type ButtonProps = ComponentProps< typeof Button > & {
	addOutline?: boolean;
};

export default function ButtonComponent( {
	className,
	variant,
	addOutline = false,
	...props
}: ButtonProps ) {
	if ( variant === 'secondary' ) {
		className = cx(
			'shadom-sm !ring-1 !ring-inset hover:bg-gray-100 ring-gray-300 !text-gray-900',
			className
		);
	}
	if ( ! addOutline ) {
		className = cx( 'focus:!shadow-none', className );
	}
	return (
		<Button
			{ ...props }
			variant={ variant }
			className={ cx(
				'px-3 py-2 !rounded-sm justify-center hover:cursor-pointer disabled:cursor-not-allowed',
				className
			) }
		/>
	);
}
