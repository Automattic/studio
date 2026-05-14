import { Icon } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import Button from 'src/components/button';
import { Tooltip } from 'src/components/tooltip';
import { useAuth } from 'src/hooks/use-auth';
import { useBetaFeatures } from 'src/hooks/use-beta-features';
import { useRemoteSessionStatus } from 'src/hooks/use-remote-session-status';
import { cx } from 'src/lib/cx';

// Lightning-bolt glyph. `@wordpress/icons` doesn't ship one (332 icons scanned
// at the time of writing), so we inline an SVG. Drawn as a rounded stroke
// rather than a filled silhouette so it reads softer next to the cog/help
// icons, and tucked into a 14px-tall bounding box so the visible height
// matches the other top-bar glyphs.
const bolt = (
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
		<path
			d="M6.25 13L13.5 5L12 11H17.75L10.5 19L12 13Z"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinejoin="round"
			strokeLinecap="round"
		/>
	</svg>
);

export function RemoteSessionIndicator() {
	const { remoteSession } = useBetaFeatures();
	const { isAuthenticated } = useAuth();

	// The toolbar control only renders when the user has opted into the
	// beta feature (via Preferences) and is signed in. Once visible it is
	// the sole entry point for starting/pausing the daemon — the settings
	// toggle controls visibility plus the initial start.
	if ( ! remoteSession || ! isAuthenticated ) {
		return null;
	}

	return <RemoteSessionButton />;
}

function RemoteSessionButton() {
	const { __ } = useI18n();
	const { isRunning, isLoading, start, stop } = useRemoteSessionStatus();

	const tooltip = isRunning ? __( 'Remote session active' ) : __( 'Remote session paused' );
	const ariaLabel = isRunning ? __( 'Pause remote session' ) : __( 'Start remote session' );

	const handleClick = () => {
		if ( isLoading ) {
			return;
		}
		void ( isRunning ? stop() : start() );
	};

	return (
		<Tooltip text={ tooltip } placement="bottom-end">
			<Button
				onClick={ handleClick }
				aria-label={ ariaLabel }
				variant="icon"
				data-testid="remote-session-indicator"
				className="!p-1.5 !rounded-lg"
			>
				<Icon
					icon={ bolt }
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
