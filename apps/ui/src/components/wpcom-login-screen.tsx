import { Button } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

// Minimal pre-auth screen shown in SecEx mode when there's no WordPress.com
// token yet. Clicking the button starts the implicit OAuth flow; the browser
// returns to the web origin with the token in the URL fragment.
export function WpcomLoginScreen( { onLogin }: { onLogin: () => void } ) {
	return (
		<div className="flex h-screen w-screen items-center justify-center bg-white">
			<div className="flex flex-col items-center gap-4 text-center">
				<h1 className="text-xl font-semibold text-gray-900">Studio Web</h1>
				<p className="max-w-xs text-sm text-gray-600">
					{ __( 'Log in with your WordPress.com account to run the agent.' ) }
				</p>
				<Button variant="primary" onClick={ onLogin }>
					{ __( 'Log in with WordPress.com' ) }
				</Button>
			</div>
		</div>
	);
}
