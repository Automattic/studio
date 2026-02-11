import { Icon, copy } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useState } from 'react';
import Button from 'src/components/button';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';

interface CopyTextButtonProps {
	text: string;
	label?: string;
	className?: string;
	copyConfirmation?: string;
	timeoutConfirmation?: number;
	children?: React.ReactNode;
	showText?: boolean;
	variant?: 'primary' | 'secondary' | 'tertiary' | 'outlined' | 'link' | 'icon';
	iconSize?: number;
	onCopied?: () => void;
	icon?: React.JSX.Element;
	'data-testid'?: string;
}

export function CopyTextButton( {
	text,
	label,
	className,
	copyConfirmation,
	timeoutConfirmation = 2000,
	children,
	showText = false,
	variant = 'link',
	iconSize = 13,
	onCopied,
	icon = copy,
	'data-testid': dataTestId,
}: CopyTextButtonProps ) {
	const { __ } = useI18n();
	const [ showCopied, setShowCopied ] = useState( false );
	const [ timeoutId, setTimeoutId ] = useState< NodeJS.Timeout | null >( null );

	const onClick = useCallback( () => {
		void getIpcApi().copyText( text );
		onCopied?.();
		setShowCopied( true );
		if ( timeoutId ) {
			clearTimeout( timeoutId );
		}
		setTimeoutId( setTimeout( () => setShowCopied( false ), timeoutConfirmation ) );
	}, [ onCopied, text, timeoutConfirmation, timeoutId ] );

	return (
		<Button
			className={ cx(
				'flex items-center [&.is-link]:text-black [&.is-link]:hover:text-[#2145e6]',
				showCopied && '[&.is-link]:text-[#2145e6]',
				className
			) }
			aria-label={ label || __( 'Copy to clipboard' ) }
			tooltipText={ __( 'Copy to clipboard' ) }
			onClick={ onClick }
			variant={ variant }
			data-testid={ dataTestId }
		>
			{ children }
			<Icon className="ml-1 mr-1" fill="currentColor" size={ iconSize } icon={ icon } />{ ' ' }
			{ showText && ! showCopied && <span>{ label }</span> }{ ' ' }
			{ showCopied && (
				<span role="alert" aria-atomic="true" className="ml-1">
					{ copyConfirmation }
				</span>
			) }
		</Button>
	);
}
