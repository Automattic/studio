import { __, sprintf } from '@wordpress/i18n';
import { backup } from '@wordpress/icons';
import { Button, Icon } from '@wordpress/ui';
import { useState } from 'react';
import { formatRelativeTime } from '@/lib/format-relative-time';
import styles from './style.module.css';
import { RestoreCheckpointDialog } from './index';
import type { CheckpointArtifactProps } from '@studio/common/ai/chat-artifacts';

/**
 * Compact chip for a checkpoint artifact in the chat transcript — emitted by
 * the agent's checkpoint tools (and the automatic pre-tool captures). Restore
 * opens the same confirmation dialog the site's checkpoint timeline uses.
 */
export function CheckpointArtifactChip( { artifact }: { artifact: CheckpointArtifactProps } ) {
	const [ restoreOpen, setRestoreOpen ] = useState( false );

	let title = artifact.label;
	if ( ! title ) {
		title = artifact.toolName
			? /* translators: %s: the agent tool a checkpoint was captured before (e.g. "wp_cli") */
			  sprintf( __( 'Checkpoint before %s' ), artifact.toolName )
			: __( 'Checkpoint' );
	}

	return (
		<div className={ styles.chip }>
			<Icon icon={ backup } size={ 16 } className={ styles.chipIcon } />
			<span className={ styles.chipTitle }>{ title }</span>
			<span className={ styles.chipTime }>
				{ formatRelativeTime( new Date( artifact.createdAt ).toISOString() ) }
			</span>
			<Button
				variant="minimal"
				tone="neutral"
				size="compact"
				onClick={ () => setRestoreOpen( true ) }
			>
				{ __( 'Restore' ) }
			</Button>
			<RestoreCheckpointDialog
				siteId={ artifact.siteId }
				checkpointId={ artifact.checkpointId }
				title={ title }
				open={ restoreOpen }
				onOpenChange={ setRestoreOpen }
			/>
		</div>
	);
}
