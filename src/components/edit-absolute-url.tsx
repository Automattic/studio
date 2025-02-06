import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useState } from 'react';
import { useSiteDetails } from '../hooks/use-site-details';
import { isMac, isWindows } from '../lib/app-globals';
import Button from './button';
import Modal from './modal';
import TextControlComponent from './text-control';

interface UrlState {
	localUrl: string;
	includePort: boolean;
}

export default function EditAbsoluteUrl() {
	const { __ } = useI18n();
	const { updateSite, selectedSite, stopServer, startServer } = useSiteDetails();
	const [ isEditingSite, setIsEditingSite ] = useState( false );
	const [ showModal, setShowModal ] = useState( false );

	// Initialize URL state from selected site
	const initialUrlState = {
		localUrl:
			selectedSite?.absoluteUrl?.replace( `:${ selectedSite?.port }`, '' ) || 'http://localhost',
		includePort: Boolean(
			selectedSite?.absoluteUrl?.includes( `:${ selectedSite?.port }` ) ||
				! selectedSite?.absoluteUrl
		),
	};
	const [ urlState, setUrlState ] = useState< UrlState >( initialUrlState );

	// Compute absolute URL
	const absoluteUrl =
		urlState.includePort && urlState.localUrl && selectedSite?.port
			? `${ urlState.localUrl }:${ selectedSite.port }`
			: urlState.localUrl;

	const handleSubmit = useCallback(
		async ( e: React.FormEvent ) => {
			e.preventDefault();
			if ( ! selectedSite || ! urlState.localUrl.trim() ) return;

			setIsEditingSite( true );
			try {
				await updateSite( {
					...selectedSite,
					absoluteUrl,
				} );

				if ( selectedSite.running ) {
					await stopServer( selectedSite.id );
					await startServer( selectedSite.id );
				}
				setShowModal( false );
			} finally {
				setIsEditingSite( false );
			}
		},
		[ absoluteUrl, selectedSite, startServer, stopServer, updateSite, urlState.localUrl ]
	);

	const closeModal = () => setShowModal( false );

	const getHostsFileInstructions = () => {
		let hostname = '';
		try {
			hostname = new URL( urlState.localUrl ).hostname;
		} catch {
			hostname = '';
		}

		if ( isWindows() ) {
			return (
				<>
					<p className="text-sm text-gray-600 mt-2">
						{ __( "To use a custom hostname, you'll need to update your hosts file:" ) }
					</p>
					<ol className="text-sm text-gray-600 list-decimal list-inside ml-2 mt-1">
						<li>{ __( 'Open Notepad as Administrator' ) }</li>
						<li>{ __( 'Open C:\\Windows\\System32\\drivers\\etc\\hosts' ) }</li>
						<li>{ __( 'Add the following line to the file:' ) }</li>
						<code className="block bg-gray-100 px-3 py-1 mt-1 text-sm rounded">
							{ `127.0.0.1 ${ hostname }` }
						</code>
					</ol>
				</>
			);
		}
		console.log( 'isMac()', isMac() );
		if ( isMac() ) {
			return (
				<>
					<p className="text-sm text-gray-600 mt-2">
						{ __( "To use a custom hostname, you'll need to update your hosts file:" ) }
					</p>
					<p>{ __( 'Add the following line to /etc/hosts:' ) }</p>
					<code className="block bg-gray-100 px-3 py-1 mt-1 text-sm rounded">
						{ `127.0.0.1 ${ hostname }` }
					</code>
				</>
			);
		}

		return null;
	};

	return (
		<>
			<Button
				disabled={ ! selectedSite }
				className="!mx-4 shrink-0"
				onClick={ () => selectedSite && setShowModal( true ) }
				label={ __( 'Edit Local URL' ) }
				variant="link"
			>
				{ __( 'Edit' ) }
			</Button>

			{ showModal && (
				<Modal
					size="medium"
					title={ __( 'Edit Local URL' ) }
					isDismissible
					focusOnMount="firstContentElement"
					onRequestClose={ closeModal }
				>
					<form onSubmit={ handleSubmit } className="flex flex-col gap-4">
						<div className="flex flex-col gap-1.5 leading-4">
							<label className="font-semibold" htmlFor="hostname-input">
								{ __( 'Hostname' ) }
							</label>
							<TextControlComponent
								id="hostname-input"
								onChange={ ( value ) =>
									setUrlState( ( prev ) => ( { ...prev, localUrl: value } ) )
								}
								value={ urlState.localUrl }
								placeholder="http://localhost"
							/>
						</div>

						<div className="flex flex-col gap-1.5 leading-4">
							<span className="font-semibold">{ __( 'Your site URL' ) }</span>
							<div className="px-3 py-1.5 bg-gray-100 rounded text-gray-600">{ absoluteUrl }</div>
							<label className="flex items-center gap-2">
								<input
									type="checkbox"
									checked={ urlState.includePort }
									onChange={ ( e ) =>
										setUrlState( ( prev ) => ( { ...prev, includePort: e.target.checked } ) )
									}
									className="form-checkbox"
								/>
								<span>
									{ __(
										'Include port in URL (Required locally. Disable for external routing like Ngrok)'
									) }
								</span>
							</label>
						</div>

						<div className="flex flex-col gap-1.5 leading-4">
							{ urlState.localUrl &&
								urlState.localUrl !== 'http://localhost' &&
								getHostsFileInstructions() }
						</div>

						<div className="flex flex-row justify-end gap-x-5 mt-6">
							<Button onClick={ closeModal } disabled={ isEditingSite } variant="tertiary">
								{ __( 'Cancel' ) }
							</Button>
							<Button
								type="submit"
								variant="primary"
								isBusy={ isEditingSite }
								disabled={ isEditingSite || ! selectedSite || ! urlState.localUrl.trim() }
							>
								{ isEditingSite ? __( 'Restarting server…' ) : __( 'Save' ) }
							</Button>
						</div>
					</form>
				</Modal>
			) }
		</>
	);
}
