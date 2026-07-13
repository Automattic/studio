import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useLogin } from '@/data/queries/use-auth-user';
import styles from './style.module.css';

export function AgenticSigninBanner() {
	const { reason } = useAgenticFeatures();
	const login = useLogin();

	if ( reason !== 'signed-out' ) {
		return null;
	}

	return (
		<section className={ styles.root } aria-label={ __( 'Sign in to Studio' ) }>
			<div className={ styles.text }>
				<h2 className={ styles.heading }>{ __( 'Sign in to do more with Studio' ) }</h2>
				<ul className={ styles.benefits }>
					<li>{ __( 'Chat with a WordPress expert that builds and edits your site for you' ) }</li>
					<li>{ __( 'Share your work instantly with preview links' ) }</li>
					<li>{ __( "Publish to a real WordPress.com site when you're ready" ) }</li>
				</ul>
			</div>
			<div className={ styles.actions }>
				<Button
					type="button"
					variant="solid"
					tone="brand"
					loading={ login.isPending }
					onClick={ () => login.mutate() }
				>
					{ __( 'Log in with WordPress.com' ) }
				</Button>
			</div>
		</section>
	);
}
