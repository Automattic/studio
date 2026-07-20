import { __ } from '@wordpress/i18n';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import styles from './style.module.css';

export function OfflineBanner() {
	const { reason } = useAgenticFeatures();

	if ( reason !== 'offline' ) {
		return null;
	}

	return (
		<section className={ styles.root } role="status">
			<h2 className={ styles.heading }>{ __( "You're offline" ) }</h2>
			<p className={ styles.description }>
				{ __(
					'Studio Code and sharing features need an internet connection. Your local sites still work normally.'
				) }
			</p>
		</section>
	);
}
