import { Modal, TextControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useState } from 'react';
import Button from 'src/components/button';
import { useConnectCpanelSiteMutation } from 'src/stores/cpanel/cpanel-connected-sites';
import type { CpanelSyncSite } from 'src/modules/cpanel/types';

type Props = {
	localSiteId: string;
	onClose: () => void;
	onConnected: ( site: CpanelSyncSite ) => void;
};

export function CpanelCredentialsModal( { localSiteId, onClose, onConnected }: Props ) {
	const { __ } = useI18n();
	const [ hostname, setHostname ] = useState( '' );
	const [ port, setPort ] = useState( '2083' );
	const [ username, setUsername ] = useState( '' );
	const [ apiToken, setApiToken ] = useState( '' );
	const [ wpPath, setWpPath ] = useState( 'public_html' );
	const [ dbName, setDbName ] = useState( '' );
	const [ error, setError ] = useState< string | null >( null );

	const [ connectCpanelSite, { isLoading } ] = useConnectCpanelSiteMutation();

	const isValid =
		hostname.trim() !== '' &&
		username.trim() !== '' &&
		apiToken.trim() !== '' &&
		wpPath.trim() !== '' &&
		dbName.trim() !== '' &&
		! isNaN( parseInt( port ) );

	const handleSubmit = async ( e: React.FormEvent ) => {
		e.preventDefault();
		setError( null );

		try {
			const site = await connectCpanelSite( {
				localSiteId,
				hostname: hostname.trim(),
				port: parseInt( port ),
				username: username.trim(),
				apiToken: apiToken.trim(),
				wpPath: wpPath.trim(),
				dbName: dbName.trim(),
			} ).unwrap();

			onConnected( site );
		} catch ( err ) {
			const msg =
				err instanceof Error
					? err.message
					: __( 'Could not connect to cPanel. Check your credentials and try again.' );
			setError( msg );
		}
	};

	return (
		<Modal
			title={ __( 'Connect cPanel Site' ) }
			onRequestClose={ onClose }
			className="w-full max-w-lg"
		>
			<form onSubmit={ handleSubmit } className="flex flex-col gap-4">
				<p className="text-a8c-gray-70 a8c-body">
					{ __(
						'Enter your cPanel credentials to connect this site. Your API token is stored locally on this computer.'
					) }
				</p>

				<TextControl
					label={ __( 'cPanel hostname' ) }
					placeholder="mysite.com"
					value={ hostname }
					onChange={ setHostname }
					disabled={ isLoading }
					autoFocus
				/>

				<TextControl
					label={ __( 'Port' ) }
					type="number"
					value={ port }
					onChange={ setPort }
					disabled={ isLoading }
					help={ __( 'Default is 2083. Change only if your host uses a custom port.' ) }
				/>

				<TextControl
					label={ __( 'cPanel username' ) }
					value={ username }
					onChange={ setUsername }
					disabled={ isLoading }
				/>

				<TextControl
					label={ __( 'API token' ) }
					type="password"
					value={ apiToken }
					onChange={ setApiToken }
					disabled={ isLoading }
					help={ __( 'Generate a token in cPanel → Security → Manage API Tokens.' ) }
				/>

				<TextControl
					label={ __( 'WordPress path' ) }
					placeholder="public_html"
					value={ wpPath }
					onChange={ setWpPath }
					disabled={ isLoading }
					help={ __( 'Path to your WordPress root relative to your cPanel home directory.' ) }
				/>

				<TextControl
					label={ __( 'Database name' ) }
					value={ dbName }
					onChange={ setDbName }
					disabled={ isLoading }
					help={ __( 'The MySQL database name as shown in cPanel → MySQL Databases.' ) }
				/>

				{ error && <p className="text-a8c-red-50 a8c-body-small">{ error }</p> }

				<div className="flex gap-3 mt-2 justify-end">
					<Button variant="tertiary" onClick={ onClose } disabled={ isLoading }>
						{ __( 'Cancel' ) }
					</Button>
					<Button
						variant="primary"
						type="submit"
						disabled={ ! isValid || isLoading }
						isBusy={ isLoading }
					>
						{ isLoading ? __( 'Connecting…' ) : __( 'Connect site' ) }
					</Button>
				</div>
			</form>
		</Modal>
	);
}
