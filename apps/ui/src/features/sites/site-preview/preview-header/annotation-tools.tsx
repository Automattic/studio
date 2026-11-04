import { __ } from '@wordpress/i18n';
import { MessageSquarePlusIcon, PencilIcon, RotateCcwIcon, Undo2Icon } from 'lucide-react';
import { IconButton } from '@/lib/ui';
import styles from './annotate-button.module.css';

export function AnnotationTools( {
	drawing,
	pending,
	canUndo,
	failed,
	disabled,
	onToggle,
	onUndo,
	onFinish,
}: {
	drawing: boolean;
	pending: boolean;
	canUndo: boolean;
	failed: boolean;
	disabled: boolean;
	onToggle: () => void;
	onUndo: () => void;
	onFinish: () => void;
} ) {
	return (
		<span className={ styles.tools } role="group" aria-label={ __( 'Annotation tools' ) }>
			<IconButton
				size="icon-sm"
				variant="accent-ghost"
				icon={ <PencilIcon /> }
				label={ __( 'Draw' ) }
				aria-pressed={ drawing }
				disabled={ disabled }
				onClick={ onToggle }
				tooltipSide="bottom"
			/>
			{ canUndo ? (
				<IconButton
					size="icon-sm"
					icon={ <Undo2Icon /> }
					label={ __( 'Undo stroke' ) }
					disabled={ disabled }
					onClick={ onUndo }
					tooltipSide="bottom"
				/>
			) : null }
			{ pending ? (
				<IconButton
					size="icon-sm"
					icon={ failed ? <RotateCcwIcon /> : <MessageSquarePlusIcon /> }
					label={ failed ? __( 'Retry capture' ) : __( 'Add note' ) }
					disabled={ disabled }
					onClick={ onFinish }
					tooltipSide="bottom"
				/>
			) : null }
		</span>
	);
}
