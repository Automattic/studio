import { __ } from '@wordpress/i18n';
import styles from './style.module.css';

export function OfflineNotice() {
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
