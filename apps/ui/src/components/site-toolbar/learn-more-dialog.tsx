import { __ } from '@wordpress/i18n';
import { InfoDialog } from './info-dialog';

type Props = {
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
};

export function LearnMoreDialog( { open, onOpenChange }: Props ) {
	return (
		<InfoDialog
			open={ open }
			onOpenChange={ onOpenChange }
			title={ __( 'Publishing and syncing' ) }
		>
			<p>
				{ __(
					'Publishing connects this local Studio site to an eligible WordPress.com or Pressable site — pick an existing site or create a new one to take it live.'
				) }
			</p>
			<p>
				{ __(
					'Syncing moves work between the two afterward. Pull from live brings selected files and database content into Studio; push to live sends selected local changes to the connected site.'
				) }
			</p>
			<p>
				{ __(
					'Database sync replaces the entire destination database. Studio creates a backup first, but recent orders, customers, or content can still be overwritten.'
				) }
			</p>
			<p>
				{ __(
					'Available for paid WordPress.com sites and Pressable sites with Jetpack enabled. Studio supports sites up to 5 GB.'
				) }
			</p>
		</InfoDialog>
	);
}
