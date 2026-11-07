import { __ } from '@wordpress/i18n';
import { MousePointer2Icon, PencilIcon, RotateCcwIcon } from 'lucide-react';
import { SendIcon, TrashIcon } from '@/lib/icons';
import { IconButton, InputGroup } from '@/lib/ui';
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
			<InputGroup
				variant="composer"
				className={ styles.tools }
				aria-label={ __( 'Annotation tools' ) }
			>
				{ pageTools ? (
					<>
						<IconButton
							size="icon"
							shape="round"
							variant="accent-ghost"
							icon={ <MousePointer2Icon /> }
							label={ __( 'Select' ) }
							aria-pressed={ ! drawing }
							disabled={ disabled }
							focusableWhenDisabled={ false }
							tooltipSide="top"
							onClick={ () => {
								if ( drawing ) onToggle();
							} }
						/>
						<IconButton
							size="icon"
							shape="round"
							variant="accent-ghost"
							icon={ <PencilIcon /> }
							label={ __( 'Draw' ) }
							aria-pressed={ drawing }
							disabled={ disabled }
							focusableWhenDisabled={ false }
							tooltipSide="top"
							onClick={ onToggle }
						/>
						{ pending && failed ? (
							<IconButton
								size="icon"
								shape="round"
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
					size="icon"
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
					size="icon"
					shape="round"
					icon={ <TrashIcon /> }
					label={ __( 'Exit annotation mode' ) }
					disabled={ disabled }
					onClick={ onExit }
					tooltipSide="top"
				/>
			</InputGroup>
		</div>
	);
}
