import { Icon, copy } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useState } from 'react';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';

interface CopyTextButtonProps {
	text: string;
	label?: string;
	className?: string;
	copyConfirmation?: string;
	timeoutConfirmation?: number;
	children?: React.ReactNode;
}

export function CopyTextButton( {
	text,
	label,
	className,
	copyConfirmation,
	timeoutConfirmation = 2000,
	children,
}: CopyTextButtonProps ) {
	const { __ } = useI18n();
	const [ showCopied, setShowCopied ] = useState( false );
	const [ timeoutId, setTimeoutId ] = useState< NodeJS.Timeout | null >( null );

	const onClick = useCallback( () => {
		getIpcApi().copyText( text );
		setShowCopied( true );
		if ( timeoutId ) {
			clearTimeout( timeoutId );
		}
		setTimeoutId( setTimeout( () => setShowCopied( false ), timeoutConfirmation ) );
	}, [ text, timeoutConfirmation, timeoutId ] );

	return (
		<Button
			className={ cx(
				'flex items-center [&.is-link]:text-black [&.is-link]:hover:text-[#2145e6]',
				showCopied && '[&.is-link]:text-[#2145e6]',
				className
			) }
			aria-label={ label || __( 'copy to clipboard' ) }
			onClick={ onClick }
			variant="link"
		>
			{ children }
			<Icon className="ml-1 mr-1" fill="currentColor" size={ 13 } icon={ copy } />
			{ showCopied && (
				<span role="alert" aria-atomic="true">
					{ copyConfirmation }
				</span>
			) }
		</Button>
	);
}
