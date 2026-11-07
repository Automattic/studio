import { __ } from '@wordpress/i18n';
import { MousePointer2Icon, PencilIcon, RotateCcwIcon } from 'lucide-react';
import { TrashIcon } from '@/lib/icons';
import { IconButton } from '@/lib/ui';
import styles from './annotation-tools.module.css';

export function AnnotationTools( {
	drawing,
	pending,
	failed,
	disabled,
	pageTools,
	onToggle,
	onRetry,
	onDiscard,
}: {
	drawing: boolean;
	pending: boolean;
	failed: boolean;
	disabled: boolean;
	pageTools: boolean;
	onToggle: () => void;
	onRetry: () => void;
	onDiscard: () => void;
} ) {
	return (
		<div className={ styles.overlay }>
			<div className={ styles.tools } role="group" aria-label={ __( 'Annotation tools' ) }>
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
					shape="round"
					icon={ <TrashIcon /> }
					label={ __( 'Discard annotations' ) }
					disabled={ disabled }
					focusableWhenDisabled={ false }
					onClick={ onDiscard }
					tooltipSide="top"
				/>
			</div>
		</div>
	);
}
