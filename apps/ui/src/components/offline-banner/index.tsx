import { __ } from '@wordpress/i18n';
import { useOffline } from '@/hooks/use-offline';
import styles from './style.module.css';

export function OfflineBanner() {
	const isOffline = useOffline();

	if ( ! isOffline ) {
		return null;
	}

	return (
		<section className={ styles.root } role="status">
			<div className={ styles.text }>
				<h2 className={ styles.heading }>{ __( "You're offline" ) }</h2>
				<p className={ styles.description }>
					{ __(
						'Studio Code and sharing features need an internet connection. Your local sites still work normally.'
					) }
				</p>
			</div>
		</section>
	);
}
