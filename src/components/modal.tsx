import { Modal as WPModal } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { cx } from 'src/lib/cx';
import type { ComponentProps } from 'react';

export default function Modal( { className, ...rest }: ComponentProps< typeof WPModal > ) {
	const { __ } = useI18n();
	return (
		<WPModal
			closeButtonLabel={ __( 'Close' ) }
			className={ cx(
				'select-none [&_h1]:!text-xl [&_h1]:!font-normal outline-0',
				'[&_h1]:flex-1 [&_h1]:rtl:text-right',
				className
			) }
			{ ...rest }
		/>
	);
}
