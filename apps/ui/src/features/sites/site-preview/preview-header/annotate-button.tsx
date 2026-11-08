import { __, _n, sprintf } from '@wordpress/i18n';
import { ariaKeyShortcut, displayShortcut } from '@wordpress/keycodes';
import { useEffect, useRef, useState } from 'react';
import { AnnotateIcon } from '@/lib/icons';
import { isDialogOpen, isShortcut } from '@/lib/keyboard';
import {
	IconButton,
	Kbd,
	NotificationDot,
	Tooltip,
	TooltipTrigger,
	TooltipContent,
} from '@/lib/ui';
import styles from './annotate-button.module.css';

export function AnnotateButton( {
	active,
	disabled,
	disabledReason,
	onClick,
	annotationCount = 0,
	pageTools = false,
}: {
	active: boolean;
	disabled: boolean;
	disabledReason?: string;
	onClick: () => void;
	annotationCount?: number;
	pageTools?: boolean;
} ) {
	const modeButton = useRef< HTMLButtonElement >( null );
	const [ tooltipOpen, setTooltipOpen ] = useState( false );
	const toggleShortcut = ariaKeyShortcut.primaryShift( '.' );
	const label = active ? __( 'Stop annotating' ) : __( 'Annotate' );
	const description = pageTools
		? __( 'Point or draw to suggest a change.' )
		: __( 'Point to something you’d like to change.' );
	useEffect( () => {
		if ( disabled ) return;
		const toggleFromKeyboard = ( event: KeyboardEvent ) => {
			if (
				event.defaultPrevented ||
				event.repeat ||
				! isShortcut( event, '.', 'shift' ) ||
				isDialogOpen() ||
				modeButton.current?.closest( '[inert], [hidden], [aria-hidden="true"]' )
			)
				return;
			event.preventDefault();
			modeButton.current?.click();
		};
		document.addEventListener( 'keydown', toggleFromKeyboard );
		return () => document.removeEventListener( 'keydown', toggleFromKeyboard );
	}, [ disabled ] );

	return (
		<Tooltip
			open={ tooltipOpen }
			onOpenChange={ ( open, details ) => {
				if ( active && details.reason === 'escape-key' ) {
					// Keep Escape available to the annotation overlay.
					details.cancel();
					details.allowPropagation();
				}
				setTooltipOpen( open );
			} }
		>
			<TooltipTrigger
				render={
					<IconButton
						ref={ modeButton }
						tooltip={ false }
						variant="accent-ghost"
						size="icon-sm"
						icon={
							<span className={ styles.icon }>
								<AnnotateIcon />
								{ annotationCount > 0 && ! active && <NotificationDot position="icon" /> }
							</span>
						}
						label={ disabledReason ?? label }
						aria-label={ __( 'Annotate' ) }
						aria-keyshortcuts={ active ? `Escape ${ toggleShortcut }` : toggleShortcut }
						aria-pressed={ active }
						aria-description={
							disabled
								? disabledReason
								: annotationCount
								? sprintf(
										_n(
											'%d annotation ready to send',
											'%d annotations ready to send',
											annotationCount
										),
										annotationCount
								  )
								: active
								? __( 'Stop annotating. Your notes will be kept.' )
								: description
						}
						disabled={ disabled }
						focusableWhenDisabled={ false }
						tooltipSide="bottom"
						onClick={ onClick }
					/>
				}
			/>
			<TooltipContent side="bottom">
				{ disabledReason ? (
					disabledReason
				) : (
					<>
						{ active ? label : description }
						{ ! disabled && (
							<Kbd>{ active ? __( 'Esc' ) : displayShortcut.primaryShift( '.' ) }</Kbd>
						) }
					</>
				) }
			</TooltipContent>
		</Tooltip>
	);
}
