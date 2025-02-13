import { createInterpolateElement } from '@wordpress/element';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useState } from 'react';
import { useDocsLink } from 'src/hooks/use-docs-link';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useSiteDetails } from '../hooks/use-site-details';
import Button from './button';
import Modal from './modal';
import TextControlComponent from './text-control';

interface UrlState {
	localUrl: string;
	skipPort: boolean;
}

export default function EditAbsoluteUrl() {
	const { __ } = useI18n();
	const getDocsLink = useDocsLink();
	const { updateSite, selectedSite, stopServer, startServer } = useSiteDetails();
	const [ isEditingSite, setIsEditingSite ] = useState( false );
	const [ showModal, setShowModal ] = useState( false );

	// Initialize URL state from selected site
	const initialUrlState = {
		localUrl:
			selectedSite?.absoluteUrl?.replace( `:${ selectedSite?.port }`, '' ) || 'http://localhost',
		skipPort:
			Boolean( selectedSite?.absoluteUrl ) &&
			! selectedSite?.absoluteUrl?.includes( `:${ selectedSite?.port }` ),
	};
	const [ urlState, setUrlState ] = useState< UrlState >( initialUrlState );

	// Compute absolute URL
	const absoluteUrl =
		! urlState.skipPort && selectedSite?.port
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
							<span className="text-a8c-gray-50 text-xs">
								{ createInterpolateElement(
									__(
										"If you're using a TLD other than .localhost, you may need to update your hosts file. <button>Learn more.</button>"
									),
									{
										button: (
											<Button
												variant="link"
												className="text-xs"
												onClick={ () => getIpcApi().openURL( getDocsLink( 'sites' ) ) }
											/>
										),
									}
								) }
							</span>
						</div>

						<div className="flex flex-col gap-1.5 leading-4">
							<span className="font-semibold">{ __( 'Your site URL' ) }</span>
							<div className="px-3 py-1.5 bg-gray-100 rounded text-gray-600">{ absoluteUrl }</div>
							<label className="flex items-center gap-2">
								<input
									type="checkbox"
									checked={ urlState.skipPort }
									onChange={ ( e ) =>
										setUrlState( ( prev ) => ( { ...prev, skipPort: e.target.checked } ) )
									}
									className="form-checkbox"
								/>
								<span>{ __( 'Skip the port to use external routing like Ngrok.' ) }</span>
							</label>
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
