import { Guide } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useState } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import versionSwitchIllustration from './assets/version-switch-illustration.svg';

export function WhatsNewModal() {
	const [ isOpen, setIsOpen ] = useState( true );

	const handleClick = ( url: string ) => {
		getIpcApi().openURL( url );
	};

	if ( ! isOpen ) {
		return null;
	}

	return (
		<Guide
			onFinish={ () => setIsOpen( false ) }
			contentLabel={ __( "What's New in Studio" ) }
			className="whats-new-modal !w-[312px] !h-[470px] overflow-hidden"
			pages={ [
				{
					image: (
						<img
							src={ versionSwitchIllustration }
							alt=""
							className="h-[173px] w-full object-cover mb-4"
						/>
					),
					content: (
						<div className="px-8 py-4">
							<h2 className="text-xl mb-4 text-gray-900">
								{ __( 'Select WordPress and PHP versions in Studio' ) }
							</h2>
							<p className="text-gray-900 text-m leading-s">
								{ __(
									'Select your preferred WordPress and PHP versions for existing sites or when creating a new one.'
								) }
							</p>
							<div className="mt-4">
								<button
									onClick={ () =>
										handleClick(
											'https://wordpress.com/blog/2025/03/17/studio-wordpress-php-versions/'
										)
									}
									className="text-a8c-blueberry text-m leading-s cursor-pointer"
								>
									{ __( 'Learn more' ) }
								</button>
							</div>
						</div>
					),
				},
				{
					content: (
						<div className="p-8">
							<h2 className="text-2xl font-semibold mb-4">{ __( 'New Feature 2' ) }</h2>
							<p className="text-gray-600 text-lg">
								{ __( 'Description of the second feature...' ) }
							</p>
						</div>
					),
				},
			] }
		/>
	);
}
