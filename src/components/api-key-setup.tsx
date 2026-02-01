import { TextControl } from '@wordpress/components';
import { Icon, cog } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useState, useCallback } from 'react';
import Button from 'src/components/button';
import Modal from 'src/components/modal';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';

interface ApiKeySetupProps {
	isOpen: boolean;
	onClose: () => void;
	onSuccess: () => void;
}

export function ApiKeySetup( { isOpen, onClose, onSuccess }: ApiKeySetupProps ) {
	const { __ } = useI18n();
	const [ apiKey, setApiKey ] = useState( '' );
	const [ isLoading, setIsLoading ] = useState( false );
	const [ error, setError ] = useState< string | null >( null );

	const handleSubmit = useCallback( async () => {
		if ( ! apiKey.trim() ) {
			setError( __( 'Please enter an API key' ) );
			return;
		}

		setIsLoading( true );
		setError( null );

		try {
			const result = await getIpcApi().configureAgentApiKey( apiKey.trim() );

			if ( result.success ) {
				setApiKey( '' );
				onSuccess();
				onClose();
			} else {
				setError( result.error || __( 'Failed to configure API key' ) );
			}
		} catch ( err ) {
			const errorMessage = err instanceof Error ? err.message : String( err );
			setError( errorMessage );
		} finally {
			setIsLoading( false );
		}
	}, [ apiKey, onClose, onSuccess, __ ] );

	const handleKeyDown = useCallback(
		( e: React.KeyboardEvent ) => {
			if ( e.key === 'Enter' && ! isLoading ) {
				void handleSubmit();
			}
		},
		[ handleSubmit, isLoading ]
	);

	if ( ! isOpen ) {
		return null;
	}

	return (
		<Modal
			title={ __( 'Configure AI Assistant' ) }
			onRequestClose={ onClose }
			className="w-[480px]"
		>
			<div className="flex flex-col gap-4 p-4">
				<p className="text-sm text-gray-600">
					{ __(
						'Enter your Anthropic API key to enable the AI assistant. Your key will be stored securely on your device.'
					) }
				</p>

				<div className="flex flex-col gap-2">
					<TextControl
						label={ __( 'API Key' ) }
						value={ apiKey }
						onChange={ setApiKey }
						onKeyDown={ handleKeyDown }
						placeholder="sk-ant-..."
						type="password"
						className={ cx( '[&_input]:font-mono', error && '[&_input]:border-a8c-red-50' ) }
						disabled={ isLoading }
					/>

					{ error && <p className="text-sm text-a8c-red-50">{ error }</p> }
				</div>

				<p className="text-xs text-gray-500">
					{ __( 'Get your API key from ' ) }
					<a
						href="https://console.anthropic.com/settings/keys"
						target="_blank"
						rel="noopener noreferrer"
						className="text-a8c-blue-50 hover:underline"
						onClick={ ( e ) => {
							e.preventDefault();
							getIpcApi().openURL( 'https://console.anthropic.com/settings/keys' );
						} }
					>
						{ __( 'Anthropic Console' ) }
					</a>
				</p>

				<div className="flex justify-end gap-2 mt-2">
					<Button variant="secondary" onClick={ onClose } disabled={ isLoading }>
						{ __( 'Cancel' ) }
					</Button>
					<Button variant="primary" onClick={ handleSubmit } disabled={ isLoading }>
						{ isLoading ? __( 'Configuring...' ) : __( 'Save API Key' ) }
					</Button>
				</div>
			</div>
		</Modal>
	);
}

interface ApiKeySetupBannerProps {
	onConfigure: () => void;
}

export function ApiKeySetupBanner( { onConfigure }: ApiKeySetupBannerProps ) {
	const { __ } = useI18n();

	return (
		<div className="flex flex-col items-center justify-center p-8 gap-4 text-center">
			<div className="w-16 h-16 rounded-full bg-a8c-blue-5 flex items-center justify-center">
				<Icon icon={ cog } size={ 32 } className="fill-a8c-blue-50" />
			</div>
			<h3 className="text-lg font-medium">{ __( 'AI Assistant Setup Required' ) }</h3>
			<p className="text-sm text-gray-600 max-w-md">
				{ __(
					'To use the AI assistant, you need to configure your Anthropic API key. The assistant uses Claude to help you manage your WordPress sites.'
				) }
			</p>
			<Button variant="primary" onClick={ onConfigure }>
				{ __( 'Configure API Key' ) }
			</Button>
		</div>
	);
}
