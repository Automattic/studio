import { __, _n, sprintf } from '@wordpress/i18n';
import { ariaKeyShortcut, displayShortcut } from '@wordpress/keycodes';
import { PencilIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { AnnotateIcon, TrashIcon } from '@/lib/icons';
import { isDialogOpen, isShortcut } from '@/lib/keyboard';
import {
	IconButton,
	Kbd,
	NotificationDot,
	Tabs,
	TabsList,
	TabsScopeIndicator,
	TabsTrigger,
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
	const focusOnExit = useRef( false );
	useLayoutEffect( () => {
		if ( ! active && focusOnExit.current ) {
			focusOnExit.current = false;
			modeButton.current?.focus();
		}
	}, [ active ] );
	const tooltip =
		disabledReason ??
		( active
			? __( 'Exit annotation mode' )
			: pageTools
			? __( 'Select an element or draw to describe a change' )
			: __( 'Point to anything to describe a change' ) );
	const description = disabled
		? disabledReason
		: annotationCount
		? sprintf(
				_n( '%d annotation ready to send', '%d annotations ready to send', annotationCount ),
				annotationCount
		  )
		: undefined;
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
			if ( active ) focusOnExit.current = true;
			onClick();
		};
		document.addEventListener( 'keydown', toggleFromKeyboard );
		return () => document.removeEventListener( 'keydown', toggleFromKeyboard );
	}, [ active, disabled, onClick ] );

	return (
		<div className={ styles.actions } role="group" aria-label={ __( 'Annotation actions' ) }>
			{ active && pageTools && onToggleDrawing ? (
				<Tabs
					value={ drawing ? 'draw' : 'select' }
					onValueChange={ ( next ) => {
						if ( ( next === 'draw' ) !== drawing ) onToggleDrawing();
					} }
				>
					<TabsList variant="scope" aria-label={ __( 'Annotation mode' ) } activateOnFocus>
						<Tooltip>
							<TooltipTrigger
								render={
									<TabsTrigger
										ref={ modeButton }
										value="select"
										className={ styles.tab }
										aria-label={ __( 'Annotate' ) }
										aria-description={ description }
										aria-keyshortcuts={ ariaKeyShortcut.primaryShift( '.' ) }
										disabled={ disabled }
									>
										<AnnotateIcon />
									</TabsTrigger>
								}
							/>
							<TooltipContent side="bottom">{ disabledReason ?? __( 'Annotate' ) }</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger
								render={
									<TabsTrigger
										value="draw"
										className={ styles.tab }
										aria-label={ __( 'Draw' ) }
										aria-description={ disabled ? disabledReason : undefined }
										disabled={ disabled }
									>
										<PencilIcon />
									</TabsTrigger>
								}
							/>
							<TooltipContent side="bottom">{ disabledReason ?? __( 'Draw' ) }</TooltipContent>
						</Tooltip>
						<TabsScopeIndicator />
					</TabsList>
				</Tabs>
			) : (
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
									description ??
									( active ? __( 'Exit annotation mode. Your notes will be kept.' ) : undefined )
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
			) }
			{ active && onDiscard ? (
				<IconButton
					size="icon-sm"
					icon={ <TrashIcon /> }
					label={ __( 'Discard annotations' ) }
					disabled={ disabled }
					focusableWhenDisabled={ false }
					onClick={ () => {
						focusOnExit.current = true;
						onDiscard();
					} }
					tooltipSide="bottom"
				/>
			) : null }
		</div>
	);
}
