import { __ } from '@wordpress/i18n';
import { check, copy, Icon } from '@wordpress/icons';
import { Tooltip } from '@wordpress/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import styles from './style.module.css';

export function CopyButton( {
	text,
	label,
	className,
}: {
	text: string;
	label: string;
	className?: string;
} ) {
	const connector = useConnector();
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

	// Route through the connector (host clipboard) — the renderer's
	// `navigator.clipboard` is denied in the Electron desktop, which left the
	// copy silently failing and the button stuck on "Copy".
	const handleCopy = useCallback( () => {
		void connector.copyText( text );
		setCopied( true );
		// Re-arm the reset on every click so copying again mid-"Copied" doesn't
		// let the earlier timer flip the state back too soon.
		if ( resetTimer.current ) {
			clearTimeout( resetTimer.current );
		}
		resetTimer.current = setTimeout( () => setCopied( false ), 2000 );
	}, [ connector, text ] );

	const copiedLabel = __( 'Copied' );
	const tooltipLabel = copied ? copiedLabel : label;

	return (
		<div className={ className }>
			<Tooltip.Root>
				<Tooltip.Trigger
					render={
						<button
							type="button"
							className={ styles.copyButton }
							onClick={ handleCopy }
							aria-label={ label }
						>
							<Icon
								icon={ copied ? check : copy }
								size={ 16 }
								fill="currentColor"
								aria-hidden="true"
							/>
						</button>
					}
				/>
				<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
					{ tooltipLabel }
				</Tooltip.Popup>
			</Tooltip.Root>
			<span className={ styles.visuallyHidden } role="status" aria-live="polite" aria-atomic="true">
				{ copied ? copiedLabel : '' }
			</span>
		</div>
	);
}
