import { __ } from '@wordpress/i18n';
import { closeSmall } from '@wordpress/icons';
import { Button } from '@/ui-desks/components';
import styles from './style.module.css';
import type { QueuedPrompt } from '@/data/queries/use-agent-run';

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
					<Button
						variant="quiet"
						size="xsmall"
						className={ styles.remove }
						icon={ closeSmall }
						onClick={ () => onRemove( item.id ) }
						label={ __( 'Discard queued follow-up' ) }
						tooltipLabel={ false }
						title={ __( 'Discard queued follow-up' ) }
					/>
				</div>
			) ) }
		</div>
	);
}
