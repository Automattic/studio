import { __ } from '@wordpress/i18n';
import { MousePointer2Icon, PencilIcon, RotateCcwIcon, Undo2Icon, XIcon } from 'lucide-react';
import { SendIcon } from '@/lib/icons';
import { IconButton } from '@/lib/ui';
import styles from './annotation-tools.module.css';

export function AnnotationTools( {
	drawing,
	pending,
	canUndo,
	undoShape,
	failed,
	disabled,
	pageTools,
	canSend,
	onToggle,
	onUndo,
	onRetry,
	onSend,
	onExit,
}: {
	drawing: boolean;
	pending: boolean;
	canUndo: boolean;
	undoShape: boolean;
	failed: boolean;
	disabled: boolean;
	pageTools: boolean;
	canSend: boolean;
	onToggle: () => void;
	onUndo: () => void;
	onRetry: () => void;
	onSend: () => void;
	onExit: () => void;
} ) {
	return (
		<div className={ styles.overlay }>
			<div className={ styles.tools } role="group" aria-label={ __( 'Annotation tools' ) }>
				{ pageTools ? (
					<>
						<IconButton
							size="sm"
							variant="accent-ghost"
							icon={ <MousePointer2Icon /> }
							label={ __( 'Select' ) }
							aria-pressed={ ! drawing }
							disabled={ disabled }
							focusableWhenDisabled={ false }
							onClick={ () => {
								if ( drawing ) onToggle();
							} }
						>
							<span className={ styles.label }>{ __( 'Select' ) }</span>
						</IconButton>
						<IconButton
							size="sm"
							variant="accent-ghost"
							icon={ <PencilIcon /> }
							label={ __( 'Draw' ) }
							aria-pressed={ drawing }
							disabled={ disabled }
							focusableWhenDisabled={ false }
							onClick={ onToggle }
						>
							<span className={ styles.label }>{ __( 'Draw' ) }</span>
						</IconButton>
						{ canUndo ? (
							<IconButton
								size="icon-sm"
								icon={ <Undo2Icon /> }
								label={ undoShape ? __( 'Undo shape' ) : __( 'Undo stroke' ) }
								disabled={ disabled }
								onClick={ onUndo }
								tooltipSide="top"
							/>
						) : null }
						{ pending && failed ? (
							<IconButton
								size="icon-sm"
								icon={ <RotateCcwIcon /> }
								label={ __( 'Retry capture' ) }
								disabled={ disabled }
								onClick={ onRetry }
								tooltipSide="top"
							/>
						) : null }
						<span className={ styles.separator } aria-hidden="true" />
					</>
				) : null }
				<IconButton
					size="icon-sm"
					variant="accent"
					shape="round"
					icon={ <SendIcon /> }
					label={ __( 'Send annotations' ) }
					disabled={ disabled || ! canSend }
					focusableWhenDisabled={ false }
					onClick={ onSend }
					tooltipSide="top"
				/>
				<IconButton
					size="icon-sm"
					icon={ <XIcon /> }
					label={ __( 'Exit annotation mode' ) }
					disabled={ disabled }
					onClick={ onExit }
					tooltipSide="top"
				/>
			</div>
		</div>
	);
}
