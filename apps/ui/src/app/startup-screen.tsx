import { WordPressIcon } from '@studio/ds/icons';
import { __ } from '@wordpress/i18n';
import styles from './startup-screen.module.css';

export function StartupScreen( { message }: { message?: string } ) {
	return (
		<div
			className={ styles.root }
			role="status"
			aria-label={ message ?? __( 'Loading WordPress Studio…' ) }
		>
			<div className={ styles.content }>
				<WordPressIcon width={ 56 } height={ 56 } />
				{ message && <p className={ styles.message }>{ message }</p> }
			</div>
		</div>
	);
}
