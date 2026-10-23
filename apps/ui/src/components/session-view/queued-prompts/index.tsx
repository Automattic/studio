import { __ } from '@wordpress/i18n';
import { PencilIcon, XIcon } from 'lucide-react';
import { IconButton } from '@/components/ui/button';
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
		<ul className={ styles.root } aria-label={ __( 'Queued messages' ) }>
			{ prompts.map( ( item ) => {
				const attachmentNames = [ ...( item.images ?? [] ), ...( item.files ?? [] ) ]
					.map( ( attachment ) => attachment.name )
					.join( ', ' );
				return (
					<li key={ item.id } className={ styles.item }>
						<span className={ styles.body }>
							<span className={ styles.text }>{ item.displayMessage ?? item.prompt }</span>
							{ attachmentNames ? (
								<span className={ styles.attachments }>{ attachmentNames }</span>
							) : null }
						</span>
						<IconButton
							icon={ <PencilIcon /> }
							label={ __( 'Edit queued message' ) }
							size="icon-sm"
							onClick={ () => onEdit( item ) }
						/>
						<IconButton
							icon={ <XIcon /> }
							label={ __( 'Remove queued message' ) }
							size="icon-sm"
							onClick={ () => onRemove( item.id ) }
						/>
					</li>
				);
			} ) }
		</ul>
	);
}
