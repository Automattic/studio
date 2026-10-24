import { __ } from '@wordpress/i18n';
import { Button } from '@/components/ui/button';
import { useLogin } from '@/data/queries/use-auth-user';
import styles from './style.module.css';
import type { TracksAuthSource } from '@studio/common/lib/record-tracks-event';

export function SigninNotice( { source }: { source: TracksAuthSource } ) {
	const login = useLogin( { source } );

	return (
		<section className={ styles.root } aria-label={ __( 'Sign in to WordPress Studio' ) }>
			<div className={ styles.text }>
				<h2 className={ styles.heading }>{ __( 'Sign in to do more with WordPress Studio' ) }</h2>
				<ul className={ styles.benefits }>
					<li>
						{ __(
							'Chat with an AI WordPress expert that helps build and edit your site alongside you'
						) }
					</li>
					<li>{ __( 'Share your work instantly with preview links' ) }</li>
					<li>{ __( "Publish to a real WordPress.com site when you're ready" ) }</li>
				</ul>
			</div>
			<div className={ styles.actions }>
				<Button
					type="button"
					variant="accent"
					loading={ login.isPending }
					onClick={ () => login.mutate() }
				>
					{ __( 'Log in with WordPress.com' ) }
				</Button>
			</div>
		</section>
	);
}
