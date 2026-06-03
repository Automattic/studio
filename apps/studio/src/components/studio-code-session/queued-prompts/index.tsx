import { __ } from '@wordpress/i18n';
import styles from './style.module.css';
import type { QueuedPrompt } from '../use-agent-run';

interface QueuedPromptsProps {
	prompts: QueuedPrompt[];
	onRemove: ( id: string ) => void;
}

export function QueuedPrompts( { prompts, onRemove }: QueuedPromptsProps ) {
	if ( prompts.length === 0 ) {
		return null;
	}
	return (
		<div className={ styles.root } aria-label={ __( 'Queued follow-ups' ) }>
			{ prompts.map( ( item ) => (
				<div key={ item.id } className={ styles.item }>
					<span className={ styles.text }>{ item.displayMessage ?? item.prompt }</span>
					<button
						type="button"
						className={ styles.remove }
						onClick={ () => onRemove( item.id ) }
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
