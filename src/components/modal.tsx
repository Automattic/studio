import { Modal as WPModal } from '@wordpress/components';
import { cx } from '../lib/cx';
import type { ComponentProps } from 'react';

export default function Modal( { className, ...rest }: ComponentProps< typeof WPModal > ) {
	return (
		<WPModal
			className={ cx( 'select-none [&_h1]:!text-xl [&_h1]:!font-normal outline-0', className ) }
			{ ...rest }
		/>
	);
}
