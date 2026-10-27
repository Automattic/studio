import { __ } from '@wordpress/i18n';
import { PencilIcon, XIcon } from 'lucide-react';
import { Button } from '@/lib/ui';
import styles from './style.module.css';
import type { QueuedPrompt } from '@/data/agent-runs/use-agent-run';

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
						<div className={ styles.row }>
							<span className={ styles.text }>{ item.displayMessage ?? item.prompt }</span>
							<span className={ styles.actions }>
								<Button
									variant="muted-ghost"
									size="icon-2xs"
									aria-label={ __( 'Edit queued message' ) }
									onClick={ () => onEdit( item ) }
								>
									<PencilIcon />
								</Button>
								<Button
									variant="muted-ghost"
									size="icon-2xs"
									aria-label={ __( 'Remove queued message' ) }
									onClick={ () => onRemove( item.id ) }
								>
									<XIcon />
								</Button>
							</span>
						</div>
						{ attachmentNames ? <span>{ attachmentNames }</span> : null }
					</li>
				);
			} ) }
		</ul>
	);
}
