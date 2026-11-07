import { __, _n, sprintf } from '@wordpress/i18n';
import { ariaKeyShortcut, displayShortcut } from '@wordpress/keycodes';
import { PencilIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { AnnotateIcon, TrashIcon } from '@/lib/icons';
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
	drawing = false,
	onToggleDrawing,
	onDiscard,
}: {
	active: boolean;
	disabled: boolean;
	disabledReason?: string;
	onClick: () => void;
	annotationCount?: number;
	pageTools?: boolean;
	drawing?: boolean;
	onToggleDrawing?: () => void;
	onDiscard?: () => void;
} ) {
	const modeButton = useRef< HTMLButtonElement >( null );
	const tooltip =
		disabledReason ??
		( active
			? __( 'Exit annotation mode' )
			: pageTools
			? __( 'Select an element or draw to describe a change' )
			: __( 'Point to anything to describe a change' ) );
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
		<div className={ styles.actions } role="group" aria-label={ __( 'Annotation actions' ) }>
			<Tooltip>
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
							label={
								disabledReason ?? ( active ? __( 'Exit annotation mode' ) : __( 'Annotate' ) )
							}
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
					}
				/>
				<TooltipContent side="bottom">
					{ tooltip }
					{ ! disabled && <Kbd>{ displayShortcut.primaryShift( '.' ) }</Kbd> }
				</TooltipContent>
			</Tooltip>
			{ active && pageTools && onToggleDrawing ? (
				<IconButton
					size="icon-sm"
					variant="accent-ghost"
					icon={ <PencilIcon /> }
					label={ __( 'Draw' ) }
					aria-pressed={ drawing }
					disabled={ disabled }
					focusableWhenDisabled={ false }
					onClick={ onToggleDrawing }
					tooltipSide="bottom"
				/>
			) : null }
			{ active && onDiscard ? (
				<IconButton
					size="icon-sm"
					icon={ <TrashIcon /> }
					label={ __( 'Discard annotations' ) }
					disabled={ disabled }
					focusableWhenDisabled={ false }
					onClick={ () => {
						onDiscard();
						modeButton.current?.focus();
					} }
					tooltipSide="bottom"
				/>
			) : null }
		</div>
	);
}
