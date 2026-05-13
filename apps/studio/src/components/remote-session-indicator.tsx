import { Icon, rss } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useEffect, useRef, useState } from 'react';
import Button from 'src/components/button';
import { Tooltip } from 'src/components/tooltip';
import { useAuth } from 'src/hooks/use-auth';
import { useBetaFeatures } from 'src/hooks/use-beta-features';
import { useRemoteSessionStatus } from 'src/hooks/use-remote-session-status';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';

const PULSE_DURATION_MS = 3000;

export function RemoteSessionIndicator() {
	const { remoteSession } = useBetaFeatures();
	const { isAuthenticated } = useAuth();

	// Gate before the hook that triggers IPC. Logged-out users (or users who
	// haven't opted into the beta feature) see no chrome change at all — no
	// pill, no tooltip, no IPC traffic. The settings pane is the only place
	// where the daemon can be started or stopped from the UI.
	if ( ! remoteSession || ! isAuthenticated ) {
		return null;
	}

	return <RemoteSessionPill />;
}

function RemoteSessionPill() {
	const { __ } = useI18n();
	const { isRunning } = useRemoteSessionStatus();
	const wasRunning = useRef( false );
	const [ isPulsing, setIsPulsing ] = useState( false );

	// Pulse briefly on the off → on transition so users notice the new affordance.
	// After ~3s we settle into the static "on" state to keep the chrome calm.
	useEffect( () => {
		const transitionedOn = isRunning && ! wasRunning.current;
		wasRunning.current = isRunning;
		if ( ! transitionedOn ) {
			return;
		}
		setIsPulsing( true );
		const timer = setTimeout( () => setIsPulsing( false ), PULSE_DURATION_MS );
		return () => clearTimeout( timer );
	}, [ isRunning ] );

	if ( ! isRunning ) {
		return null;
	}

	const label = __( 'Remote session active' );

	return (
		<Tooltip text={ label } placement="bottom-end">
			<Button
				onClick={ () => void getIpcApi().showUserSettings( 'general', 'remote-session' ) }
				aria-label={ label }
				variant="icon"
				data-testid="remote-session-indicator"
				className="!p-1.5 !rounded-lg"
			>
				<Icon
					icon={ rss }
					size={ 24 }
					className={ cx(
						'!text-frame-running !fill-frame-running',
						isPulsing && 'animate-pulse'
					) }
				/>
			</Button>
		</Tooltip>
	);
}
