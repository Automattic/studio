import { Modal as WPModal } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useEffect, type ComponentProps } from 'react';
import { isLinux, isWindows } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';

export default function Modal( { className, ...rest }: ComponentProps< typeof WPModal > ) {
	const { __ } = useI18n();

	useEffect( () => {
		if ( ! isWindows() && ! isLinux() ) {
			return;
		}
		void getIpcApi().setTitleBarBackdropEffect( true );
		return () => {
			void getIpcApi().setTitleBarBackdropEffect( false );
		};
	}, [] );

	return (
		<WPModal
			closeButtonLabel={ __( 'Close' ) }
			className={ cx(
				'select-none [&_h1]:!text-xl [&_h1]:!font-normal outline-0',
				'[&_h1]:flex-1 [&_h1]:text-start',
				'[&_[role="document"]>div:first-child_button]:rtl:left-0',
				'[&_[role="document"]>div:first-child_button]:rtl:right-2',
				'[&_[role="document"]>div:first-child_button]:ltr:left-2',
				'[&_[role="document"]>div:first-child_button]:ltr:right-0',
				className
			) }
			{ ...rest }
		/>
	);
}
