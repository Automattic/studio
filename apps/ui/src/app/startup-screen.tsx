import { __ } from '@wordpress/i18n';
import { WordPressIcon } from '@/lib/icons';
import styles from './startup-screen.module.css';

export function StartupScreen() {
	return (
		<div className={ styles.root } role="status" aria-label={ __( 'Loading Studio…' ) }>
			<WordPressIcon width={ 68 } height={ 68 } />
		</div>
	);
}
