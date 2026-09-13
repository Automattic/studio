import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useSaveUserPreferences } from '@/data/queries/use-user-preferences';
import styles from './style.module.css';

// A quiet nudge on the overview while agentic features are switched off:
// turning them back on makes chat the site's home again, so it goes straight
// there.
export function StudioCodeUpsell( { siteId }: { siteId: string } ) {
	const navigate = useNavigate();
	const { chatEnabled, reason, isReady } = useAgenticFeatures();
	const savePreferences = useSaveUserPreferences();

	if ( ! isReady || chatEnabled || reason === 'offline' ) {
		return null;
	}

	const turnOn = () =>
		savePreferences.mutate(
			{ agenticFeaturesEnabled: true },
			{
				onSuccess: () => void navigate( { to: '/sites/$siteId/new', params: { siteId } } ),
			}
		);

	return (
		<div className={ styles.upsell }>
			<h2 className={ styles.upsellHeading }>{ __( 'Build this site with an AI expert' ) }</h2>
			<p className={ styles.upsellText }>
				{ __(
					'Studio Code chats with you to build themes, write plugins, and make changes, right here in Studio.'
				) }
			</p>
			<div>
				<Button
					variant="outline"
					tone="neutral"
					size="compact"
					loading={ savePreferences.isPending }
					loadingAnnouncement={ __( 'Turning on Studio Code' ) }
					onClick={ turnOn }
				>
					{ __( 'Turn on Studio Code' ) }
				</Button>
			</div>
		</div>
	);
}
