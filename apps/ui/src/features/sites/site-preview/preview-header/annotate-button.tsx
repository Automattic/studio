import { __, _n, sprintf } from '@wordpress/i18n';
import { ariaKeyShortcut, displayShortcut } from '@wordpress/keycodes';
import { useEffect, useRef } from 'react';
import { AnnotateHint } from '@/features/onboarding';
import { AnnotateIcon } from '@/lib/icons';
import { isDialogOpen, isShortcut } from '@/lib/keyboard';
import { IconButton, Kbd, NotificationDot } from '@/lib/ui';
import styles from './annotate-button.module.css';

export function AnnotateButton( {
	active,
	disabled,
	disabledReason,
	onClick,
	annotationCount = 0,
}: {
	active: boolean;
	disabled: boolean;
	disabledReason?: string;
	onClick: () => void;
	annotationCount?: number;
} ) {
	const modeButton = useRef< HTMLButtonElement >( null );
	const tooltip =
		disabledReason ??
		( active ? __( 'Exit annotation mode' ) : __( 'Point to anything to describe a change' ) );
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
		<AnnotateHint
			enabled={ ! disabled }
			active={ active }
			tooltip={
				<>
					{ tooltip }
					{ ! disabled && <Kbd>{ displayShortcut.primaryShift( '.' ) }</Kbd> }
				</>
			}
		>
			<IconButton
				ref={ modeButton }
				data-walkthrough="annotate"
				tooltip={ false }
				variant="accent-ghost"
				size="icon-sm"
				icon={
					<span className={ styles.icon }>
						<AnnotateIcon />
						{ annotationCount > 0 && ! active && <NotificationDot position="icon" /> }
					</span>
				}
				label={ disabledReason ?? ( active ? __( 'Exit annotation mode' ) : __( 'Annotate' ) ) }
				aria-label={ __( 'Annotate' ) }
				aria-keyshortcuts={ ariaKeyShortcut.primaryShift( '.' ) }
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
						? __( 'Exit annotation mode. Your notes will be kept.' )
						: undefined
				}
				disabled={ disabled }
				focusableWhenDisabled={ false }
				tooltipSide="bottom"
				onClick={ onClick }
			/>
		</AnnotateHint>
	);
}
