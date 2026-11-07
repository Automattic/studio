import { __ } from '@wordpress/i18n';
import { MousePointer2Icon, PencilIcon, RotateCcwIcon } from 'lucide-react';
import { SendIcon, TrashIcon } from '@/lib/icons';
import { IconButton } from '@/lib/ui';
import styles from './annotation-tools.module.css';

export function AnnotationTools( {
	drawing,
	pending,
	failed,
	disabled,
	pageTools,
	canSend,
	onToggle,
	onRetry,
	onSend,
	onExit,
}: {
	drawing: boolean;
	pending: boolean;
	failed: boolean;
	disabled: boolean;
	pageTools: boolean;
	canSend: boolean;
	onToggle: () => void;
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
					icon={ <TrashIcon /> }
					label={ __( 'Exit annotation mode' ) }
					disabled={ disabled }
					onClick={ onExit }
					tooltipSide="top"
				/>
			</div>
		</div>
	);
}
