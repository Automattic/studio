import { __ } from '@wordpress/i18n';
import styles from './style.module.css';
import type { QueuedPrompt } from '@/data/queries/use-agent-run';

interface QueuedPromptsProps {
	prompts: QueuedPrompt[];
	onRemove: ( id: string ) => void;
	onEdit: ( prompt: QueuedPrompt ) => void;
}

export function QueuedPrompts( { prompts, onRemove, onEdit }: QueuedPromptsProps ) {
	if ( prompts.length === 0 ) {
		return null;
	}
	return (
		<div className={ styles.root } aria-label={ __( 'Queued follow-ups' ) }>
			{ prompts.map( ( item ) => (
				<div
					key={ item.id }
					className={ styles.item }
					tabIndex={ 0 }
					role="button"
					onDoubleClick={ () => onEdit( item ) }
					onKeyDown={ ( event ) => {
						if ( event.key !== 'Enter' && event.key !== ' ' ) {
							return;
						}
						event.preventDefault();
						onEdit( item );
					} }
					title={ __( 'Double-click to edit queued follow-up' ) }
					aria-label={ __( 'Edit queued follow-up' ) }
				>
					<span className={ styles.text }>{ item.displayMessage ?? item.prompt }</span>
					<button
						type="button"
						className={ styles.remove }
						onClick={ ( event ) => {
							event.stopPropagation();
							onRemove( item.id );
						} }
						onDoubleClick={ ( event ) => event.stopPropagation() }
						aria-label={ __( 'Discard queued follow-up' ) }
						title={ __( 'Discard queued follow-up' ) }
					>
						×
					</button>
				</div>
			) ) }
		</div>
	);
}
