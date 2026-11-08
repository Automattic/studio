import { __ } from '@wordpress/i18n';
import { RotateCcwIcon } from 'lucide-react';
import { useRef } from 'react';
import { DrawIcon, SelectIcon, TrashIcon, type DrawIconHandle } from '@/lib/icons';
import { IconButton } from '@/lib/ui';
import styles from './annotation-tools.module.css';

export function AnnotationTools( {
	visible,
	drawing,
	pending,
	failed,
	disabled,
	pageTools,
	onToggle,
	onRetry,
	onDiscard,
}: {
	visible: boolean;
	drawing: boolean;
	pending: boolean;
	failed: boolean;
	disabled: boolean;
	pageTools: boolean;
	onToggle: () => void;
	onRetry: () => void;
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
							size="icon"
							shape="round"
							variant="accent-ghost"
							icon={ <SelectIcon /> }
							label={ __( 'Select' ) }
							shortcut={ { displayShortcut: 'V', ariaKeyShortcut: 'v' } }
							aria-pressed={ ! drawing }
							disabled={ disabled }
							focusableWhenDisabled={ false }
							tooltip={ visible }
							tooltipSide="top"
							onClick={ () => {
								if ( drawing ) onToggle();
							} }
						/>
						<IconButton
							size="icon"
							shape="round"
							variant="accent-ghost"
							icon={ <DrawIcon ref={ drawIcon } /> }
							label={ __( 'Draw' ) }
							shortcut={ { displayShortcut: 'D', ariaKeyShortcut: 'd' } }
							aria-pressed={ drawing }
							disabled={ disabled }
							focusableWhenDisabled={ false }
							tooltip={ visible }
							tooltipSide="top"
							onClick={ ( event ) => {
								onToggle();
								if ( ! drawing && event.detail > 0 ) drawIcon.current?.play();
							} }
						/>
						{ pending && failed ? (
							<IconButton
								size="icon"
								shape="round"
								icon={ <RotateCcwIcon /> }
								label={ __( 'Retry capture' ) }
								disabled={ disabled }
								tooltip={ visible }
								onClick={ onRetry }
								tooltipSide="top"
							/>
						) : null }
					</>
				) : null }
				<IconButton
					size="icon"
					shape="round"
					destructive
					icon={ <TrashIcon /> }
					label={ __( 'Discard annotations' ) }
					disabled={ disabled }
					focusableWhenDisabled={ false }
					tooltip={ visible }
					onClick={ onDiscard }
					tooltipSide="top"
				/>
			</div>
		</div>
	);
}
