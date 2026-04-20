import { Button, __experimentalVStack as VStack } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { close } from '@wordpress/icons';
import React, { useEffect, useRef } from 'react';
import { isWindows } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';

interface FullscreenModalProps {
	isOpen: boolean;
	onClose: () => void;
	children: React.ReactNode;
}

export const FullscreenModal: React.FC< FullscreenModalProps > = ( {
	isOpen,
	onClose,
	children,
} ) => {
	const modalRef = useRef< HTMLDivElement >( null );
	const previousActiveElement = useRef< HTMLElement | null >( null );

	useEffect( () => {
		const handleEscKey = ( event: KeyboardEvent ) => {
			if ( event.key === 'Escape' && isOpen ) {
				onClose();
			}
		};

		if ( isOpen ) {
			void getIpcApi().setWindowControlVisibility( false );
			document.addEventListener( 'keydown', handleEscKey );
			document.body.style.overflow = 'hidden';
			previousActiveElement.current = document.activeElement as HTMLElement;
			if ( modalRef.current ) {
				modalRef.current.focus();
			}
		}

		return () => {
			void getIpcApi().setWindowControlVisibility( true );
			document.removeEventListener( 'keydown', handleEscKey );
			document.body.style.overflow = '';
			if ( previousActiveElement.current && previousActiveElement.current.focus ) {
				previousActiveElement.current.focus();
			}
		};
	}, [ isOpen, onClose ] );

	if ( ! isOpen ) {
		return null;
	}

	return (
		<div
			ref={ modalRef }
			className="fixed inset-0 bg-frame text-frame-text z-[999999]"
			tabIndex={ -1 }
			role="dialog"
			aria-modal="true"
			data-fullscreen-modal
		>
			<div aria-hidden="true" className="absolute top-0 left-0 right-0 h-16 z-10 app-drag-region" />
			<VStack alignment="top" className="w-full h-full overflow-y-auto px-6">
				{ children }
			</VStack>
			<Button
				icon={ close }
				onClick={ onClose }
				label={ __( 'Close' ) }
				className={ cx(
					'!absolute top-4 z-20 app-no-drag-region',
					isWindows() ? 'ltr:left-4 rtl:right-4' : 'ltr:right-4 rtl:left-4'
				) }
			/>
		</div>
	);
};
