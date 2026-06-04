import { __ } from '@wordpress/i18n';
import styles from './style.module.css';

export function UnassignedOverviewView() {
	return (
		<div className={ styles.root }>
			<div className={ styles.content }>
				<h1 className={ styles.title }>{ __( 'Unassigned chats' ) }</h1>
				<p className={ styles.description }>
					{ __(
						'These chats are not connected to a local WordPress site. They can still be used for general help, but they do not have site-specific context.'
					) }
				</p>
			</div>
		</div>
	);
}
