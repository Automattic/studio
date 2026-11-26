import { __ } from '@wordpress/i18n';
import { CloudPage } from '../cloud-page';
import styles from '../style.module.css';

/** For a visitor who isn't signed in. */
export function CloudSignIn( { onSignIn }: { onSignIn: () => void } ) {
	const signIn = (
		<button type="button" className={ styles.primary } onClick={ onSignIn }>
			{ __( 'Sign in with WordPress.com' ) }
		</button>
	);
	return (
		<CloudPage action={ null }>
			<div className={ styles.sectionHead }>
				<span className={ styles.pill }>{ __( 'Studio Cloud' ) }</span>
				<h1 className={ styles.title }>{ __( 'Your Studio, in the cloud.' ) }</h1>
				<p className={ styles.lede }>
					{ __(
						'Your sites and Studio Code on a machine of your own, from any browser. Sign in with your WordPress.com account to open your workspace.'
					) }
				</p>
				<div className={ styles.actions }>{ signIn }</div>
			</div>
		</CloudPage>
	);
}
