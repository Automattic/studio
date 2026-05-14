import { FormToggle } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useState } from 'react';
import { useBetaFeatures } from 'src/hooks/use-beta-features';
import { useRemoteSessionStatus } from 'src/hooks/use-remote-session-status';
import { getIpcApi } from 'src/lib/get-ipc-api';

export function RemoteSessionToggle() {
	const { __ } = useI18n();
	const { remoteSession } = useBetaFeatures();
	const { isRunning, start, stop } = useRemoteSessionStatus();
	const [ isSaving, setIsSaving ] = useState( false );

	const handleChange = async ( checked: boolean ) => {
		if ( isSaving ) {
			return;
		}
		setIsSaving( true );
		try {
			if ( checked ) {
				// Reveal the toolbar control first so the user can see it pulse to life
				// as the daemon starts, then kick off the daemon.
				await getIpcApi().updateBetaFeature( 'remoteSession', true );
				if ( ! isRunning ) {
					await start();
				}
			} else {
				// Stop the daemon first so it's not left running invisibly after the
				// toolbar control is hidden, then hide the control.
				if ( isRunning ) {
					await stop();
				}
				await getIpcApi().updateBetaFeature( 'remoteSession', false );
			}
		} finally {
			setIsSaving( false );
		}
	};

	return (
		<div className="flex justify-start items-start gap-2">
			<FormToggle
				className="mt-0.5"
				id="remote-session-toggle"
				checked={ remoteSession }
				disabled={ isSaving }
				onChange={ ( event ) => handleChange( event.target.checked ) }
			/>
			<div className="flex flex-col gap-1">
				<label htmlFor="remote-session-toggle" className="font-semibold">
					{ __( 'Remote session' ) }
				</label>
				<div className="a8c-body-small text-frame-text-secondary">
					{ __(
						'Show a toolbar control to start and pause remote control of Studio from Telegram. Message Dolly (@wordpress_com_bot) once a session is active.'
					) }
				</div>
			</div>
		</div>
	);
}
