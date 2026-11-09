import { __ } from '@wordpress/i18n';
import { useRef } from 'react';
import { DrawIcon, SelectIcon, TrashIcon, type DrawIconHandle } from '@/lib/icons';
import { IconButton } from '@/lib/ui';
import styles from './annotation-tools.module.css';

export function AnnotationTools( {
	visible,
	drawing,
	disabled,
	pageTools,
	onToggle,
	onDiscard,
}: {
	visible: boolean;
	drawing: boolean;
	disabled: boolean;
	pageTools: boolean;
	onToggle: () => void;
	onDiscard: () => void;
} ) {
	const drawIcon = useRef< DrawIconHandle >( null );
	return (
		<div className={ styles.overlay }>
			<div
				className={ styles.tools }
				role="group"
				aria-label={ __( 'Annotation tools' ) }
				aria-hidden={ ! visible }
				data-visible={ visible || undefined }
				inert={ ! visible }
			>
				{ pageTools ? (
					<>
						<IconButton
							shape="round"
							variant="accent-ghost"
							icon={ <SelectIcon /> }
							label={ __( 'Select' ) }
							shortcut={ { displayShortcut: 'V', ariaKeyShortcut: 'v' } }
							aria-pressed={ ! drawing }
							disabled={ disabled }
							focusableWhenDisabled={ false }
							tooltip={ visible }
							onClick={ () => {
								if ( drawing ) onToggle();
							} }
						/>
						<IconButton
							shape="round"
							variant="accent-ghost"
							icon={ <DrawIcon ref={ drawIcon } /> }
							label={ __( 'Draw' ) }
							shortcut={ { displayShortcut: 'D', ariaKeyShortcut: 'd' } }
							aria-pressed={ drawing }
							disabled={ disabled }
							focusableWhenDisabled={ false }
							tooltip={ visible }
							onClick={ ( event ) => {
								onToggle();
								if ( ! drawing && event.detail > 0 ) drawIcon.current?.play();
							} }
						/>
					</>
				) : null }
				<IconButton
					shape="round"
					destructive
					icon={ <TrashIcon /> }
					label={ __( 'Discard annotations' ) }
					disabled={ disabled }
					focusableWhenDisabled={ false }
					tooltip={ visible }
					onClick={ onDiscard }
				/>
			</div>
		</div>
	);
}
