import { __ } from '@wordpress/i18n';
import { useLogin } from '@/data/queries/use-auth-user';
import { useOffline } from '@/lib/hooks';
import { Button } from '@/lib/ui';
import styles from './style.module.css';
import type { TracksAuthSource } from '@studio/common/lib/record-tracks-event';

export function AuthActions( { source }: { source: TracksAuthSource } ) {
	const isOffline = useOffline();
	const login = useLogin( { source } );
	const signup = useLogin( { signup: true, source } );
	const authError = login.error ?? signup.error;
	const offlineMessage = __( "You're currently offline." );
	const arrow = (
		<span aria-hidden className={ styles.arrow }>
			{ '↗' }
		</span>
	);

	return (
		<div className={ styles.root }>
			<div className={ styles.actions }>
				<Button
					variant="ghost"
					disabled={ isOffline || login.isPending }
					title={ isOffline ? offlineMessage : undefined }
					loading={ signup.isPending }
					onClick={ () => signup.mutate() }
				>
					{ __( 'Sign up' ) }
					{ arrow }
				</Button>
				<Button
					variant="accent"
					disabled={ isOffline || signup.isPending }
					title={ isOffline ? offlineMessage : undefined }
					loading={ login.isPending }
					onClick={ () => login.mutate() }
				>
					{ __( 'Log in with WordPress.com' ) }
					{ arrow }
				</Button>
			</div>
			{ authError && (
				<p role="alert" className={ styles.error }>
					{ authError instanceof Error
						? authError.message
						: __( 'Authentication failed. Please try again.' ) }
				</p>
			) }
		</div>
	);
}
