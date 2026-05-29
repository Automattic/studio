import { Icon } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import boltIcon from 'src/components/bolt-icon';
import Button from 'src/components/button';
import { Tooltip } from 'src/components/tooltip';
import { useAuth } from 'src/hooks/use-auth';
import { useBetaFeatures } from 'src/hooks/use-beta-features';
import { useRemoteSessionStatus } from 'src/hooks/use-remote-session-status';
import { cx } from 'src/lib/cx';

export function RemoteSessionIndicator() {
	const { remoteSession } = useBetaFeatures();
	const { isAuthenticated } = useAuth();

	// The toolbar control mirrors the Preferences toggle one-for-one. Both are
	// gated on the beta feature (the opt-in surface) and on the user being
	// signed in (the daemon needs WordPress.com auth tokens).
	if ( ! remoteSession || ! isAuthenticated ) {
		return null;
	}

	return <RemoteSessionButton />;
}

function RemoteSessionButton() {
	const { __ } = useI18n();
	const { isRunning, isLoading, start, stop } = useRemoteSessionStatus();

	// Tooltip describes the action the click will take, mirroring how Studio's
	// other toggle buttons describe themselves.
	const label = isRunning ? __( 'Stop remote session' ) : __( 'Start remote session' );

	const handleClick = () => {
		if ( isLoading ) {
			return;
		}
		void ( isRunning ? stop() : start() );
	};

	return (
		<Tooltip text={ label } placement="bottom-end">
			<Button
				onClick={ handleClick }
				aria-label={ label }
				variant="icon"
				data-testid="remote-session-indicator"
				className="!p-1.5 !rounded-lg"
			>
				<Icon
					icon={ boltIcon }
					size={ 24 }
					className={ cx(
						// `!` beats Gutenberg's `.components-button` color override; the
						// SVG path uses `stroke="currentColor"` so this drives the stroke.
						isRunning ? '!text-frame-running' : 'text-white',
						// Pulse during in-flight transitions only — from the click that
						// initiated start/stop until the post-call status refresh resolves.
						isLoading && 'animate-pulse'
					) }
				/>
			</Button>
		</Tooltip>
	);
}
