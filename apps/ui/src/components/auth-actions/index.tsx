import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useLogin } from '@/data/queries/use-auth-user';
import { useOffline } from '@/hooks/use-offline';
import styles from './style.module.css';

interface AuthActionsProps {
	className?: string;
}

// Shared by the welcome, tour and connect screens so the sign-in prompts
// can't drift apart.
export function AuthActions( { className }: AuthActionsProps ) {
	const isOffline = useOffline();
	const login = useLogin();
	const signup = useLogin( { signup: true } );
	const authError = login.error ?? signup.error;
	const offlineMessage = __( "You're currently offline." );
	const arrow = (
		<span aria-hidden className={ styles.arrow }>
			{ '↗' }
		</span>
	);

	return (
		<div className={ clsx( styles.root, className ) }>
			<div className={ styles.actions }>
				<Button
					type="button"
					variant="minimal"
					tone="neutral"
					disabled={ isOffline || login.isPending }
					title={ isOffline ? offlineMessage : undefined }
					loading={ signup.isPending }
					onClick={ () => signup.mutate() }
				>
					{ __( 'Sign up' ) }
					{ arrow }
				</Button>
				<Button
					type="button"
					variant="solid"
					tone="brand"
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
