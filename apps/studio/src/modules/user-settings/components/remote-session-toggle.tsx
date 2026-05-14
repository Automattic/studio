import { FormToggle } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import {
	useGetShowRemoteSessionInToolbarQuery,
	useSaveShowRemoteSessionInToolbarMutation,
} from 'src/stores/installed-apps-api';

export function RemoteSessionToggle() {
	const { __ } = useI18n();
	const { data: showInToolbar = false } = useGetShowRemoteSessionInToolbarQuery();
	const [ saveShowInToolbar, { isLoading: isSaving } ] =
		useSaveShowRemoteSessionInToolbarMutation();

	const handleChange = ( checked: boolean ) => {
		if ( isSaving ) {
			return;
		}
		void saveShowInToolbar( checked );
	};

	return (
		<div className="flex justify-start items-start gap-2">
			<FormToggle
				className="mt-0.5"
				id="remote-session-toggle"
				checked={ showInToolbar }
				disabled={ isSaving }
				onChange={ ( event ) => handleChange( event.target.checked ) }
			/>
			<div className="flex flex-col gap-1">
				<label htmlFor="remote-session-toggle" className="font-semibold">
					{ __( 'Remote session' ) }
				</label>
				<div className="a8c-body-small text-frame-text-secondary">
					{ __(
						'Show a toolbar control to start and stop remote control of Studio from Telegram. Message Dolly (@wordpress_com_bot) once a session is active.'
					) }
				</div>
			</div>
		</div>
	);
}
