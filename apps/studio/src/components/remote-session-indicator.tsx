import { Icon, mobile } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { Tooltip } from 'src/components/tooltip';
import { useAuth } from 'src/hooks/use-auth';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { useRemoteSessionStatus } from 'src/hooks/use-remote-session-status';
import { cx } from 'src/lib/cx';

export function RemoteSessionIndicator() {
	const { enableRemoteSessionUi } = useFeatureFlags();
	const { isAuthenticated } = useAuth();

	// Gate before the hook that triggers IPC. Logged-out users (or users
	// without the flag) see no chrome change at all — no disabled affordance,
	// no tooltip, no IPC traffic.
	if ( ! enableRemoteSessionUi || ! isAuthenticated ) {
		return null;
	}

	return <RemoteSessionIndicatorActive />;
}

function RemoteSessionIndicatorActive() {
	const { __ } = useI18n();
	const { status, isLoading, start, stop } = useRemoteSessionStatus();

	const isRunning = status?.running === true;
	// On copy mirrors the CLI's `/remote-session attach` success message so
	// users on either surface see the same "what now?" instruction.
	const tooltipText = isRunning
		? __( 'Remote session is on. Message Dolly (@wordpress_com_bot) on Telegram to work with Studio.' )
		: __( 'Remote session is off' );
	const ariaLabel = isRunning ? __( 'Stop remote session' ) : __( 'Start remote session' );

	const handleClick = async () => {
		if ( isLoading ) {
			return;
		}
		if ( isRunning ) {
			await stop();
		} else {
			await start();
		}
	};

	return (
		<Tooltip text={ tooltipText } placement="bottom-end">
			<button
				type="button"
				role="switch"
				aria-checked={ isRunning }
				aria-label={ ariaLabel }
				onClick={ handleClick }
				disabled={ isLoading }
				data-testid="remote-session-indicator"
				className={ cx(
					'relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full',
					'transition-colors duration-200 ease-in-out',
					'focus:outline-none focus-visible:ring-2 focus-visible:ring-frame-theme focus-visible:ring-offset-1',
					'disabled:opacity-40 disabled:cursor-not-allowed',
					isRunning ? 'bg-frame-theme' : 'bg-white/40'
				) }
			>
				<span
					className={ cx(
						'inline-flex h-4 w-4 items-center justify-center rounded-full bg-white shadow',
						'transition-transform duration-200 ease-in-out',
						isRunning ? 'translate-x-[18px]' : 'translate-x-0.5'
					) }
				>
					<Icon
						icon={ mobile }
						size={ 12 }
						className={ cx( isRunning ? 'fill-frame-theme' : 'fill-frame-text-secondary' ) }
					/>
				</span>
			</button>
		</Tooltip>
	);
}
