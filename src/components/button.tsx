import { Button } from '@wordpress/components';
import { ComponentProps } from 'react';
import { cx } from '../lib/cx';

type ButtonProps = ComponentProps< typeof Button >;

export default function ButtonComponent( { className, variant, ...props }: ButtonProps ) {
	if ( variant === 'secondary' ) {
		className = cx( 'shadom-sm !ring-1 !ring-inset ring-gray-300 !text-gray-900', className );
	}
	return (
		<Button
			{ ...props }
			variant={ variant }
			className={ cx( 'px-3 py-2 font-semibold !rounded-md', className ) }
		/>
	);
}
