import {
	Button,
	__experimentalHStack as HStack,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { close } from '@wordpress/icons';
import React, { useEffect, useRef } from 'react';
import { isLinux, isWindows } from 'src/lib/app-globals';
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
		<VStack
			ref={ modalRef }
			className="fixed inset-0 bg-frame text-frame-text z-[999999] flex flex-col"
			tabIndex={ -1 }
			role="dialog"
			aria-modal="true"
			data-fullscreen-modal
		>
			<HStack
				className={ cx(
					'flex p-4 app-drag-region',
					isWindows() || isLinux()
						? 'ltr:justify-start rtl:justify-end'
						: 'ltr:justify-end rtl:justify-start'
				) }
			>
				<Button
					icon={ close }
					onClick={ onClose }
					label={ __( 'Close' ) }
					className="app-no-drag-region"
				/>
			</HStack>
			<VStack alignment="top" className="w-full flex-1 overflow-y-auto px-6 pb-6">
				{ children }
			</VStack>
		</VStack>
	);
};
