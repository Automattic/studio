import { FormToggle } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useRemoteSessionStatus } from 'src/hooks/use-remote-session-status';

export function RemoteSessionToggle() {
	const { __ } = useI18n();
	const { isRunning, isLoading, start, stop } = useRemoteSessionStatus();

	const handleChange = ( checked: boolean ) => {
		if ( isLoading ) {
			return;
		}
		void ( checked ? start() : stop() );
	};

	return (
		<div className="flex justify-start items-start gap-2">
			<FormToggle
				className="mt-0.5"
				id="remote-session-toggle"
				checked={ isRunning }
				disabled={ isLoading }
				onChange={ ( event ) => handleChange( event.target.checked ) }
			/>
			<div className="flex flex-col gap-1">
				<label htmlFor="remote-session-toggle" className="font-semibold">
					{ __( 'Remote session' ) }
				</label>
				<div className="a8c-body-small text-frame-text-secondary">
					{
						/* translators: "Dolly" is the proper name of the WordPress.com Telegram bot the daemon talks to. The "@wordpress_com_bot" handle should not be translated. */
						__(
							'Control Studio from Telegram. Message Dolly (@wordpress_com_bot) once the session is active.'
						)
					}
				</div>
			</div>
		</div>
	);
}
