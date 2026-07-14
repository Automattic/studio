import { __ } from '@wordpress/i18n';
import { check, copy, Icon } from '@wordpress/icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Tooltip } from 'src/components/tooltip';
import { getIpcApi } from 'src/lib/get-ipc-api';
import styles from './copy-button.module.css';

export function CopyButton( {
	text,
	label,
	className,
}: {
	text: string;
	label: string;
	className?: string;
} ) {
	const [ copied, setCopied ] = useState( false );
	const resetTimer = useRef< ReturnType< typeof setTimeout > | null >( null );

	// Clear any pending reset when the button unmounts.
	useEffect( () => {
		return () => {
			if ( resetTimer.current ) {
				clearTimeout( resetTimer.current );
			}
		};
	}, [] );

	const handleCopy = useCallback( () => {
		void getIpcApi().copyText( text );
		setCopied( true );
		// Re-arm the reset on every click so copying again mid-"Copied" doesn't
		// let the earlier timer flip the state back too soon.
		if ( resetTimer.current ) {
			clearTimeout( resetTimer.current );
		}
		resetTimer.current = setTimeout( () => setCopied( false ), 2000 );
	}, [ text ] );

	const copiedLabel = __( 'Copied' );
	const tooltipLabel = copied ? copiedLabel : label;

	return (
		<div className={ className }>
			<Tooltip text={ tooltipLabel }>
				<button
					type="button"
					className={ styles.copyButton }
					onClick={ handleCopy }
					aria-label={ label }
				>
					<Icon icon={ copied ? check : copy } size={ 16 } fill="currentColor" aria-hidden="true" />
				</button>
			</Tooltip>
			<span className={ styles.visuallyHidden } role="status" aria-live="polite" aria-atomic="true">
				{ copied ? copiedLabel : '' }
			</span>
		</div>
	);
}
