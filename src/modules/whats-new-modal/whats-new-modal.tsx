import { Guide } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useState } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import previewSitesIllustration from './assets/preview-sites-illustration.svg';
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
					image: (
						<img
							src={ previewSitesIllustration }
							alt=""
							className="h-[173px] w-full object-cover mb-4"
						/>
					),
					content: (
						<div className="px-8 py-4">
							<h2 className="text-xl mb-4 text-gray-900">
								{ __( 'Share your work easily with Preview sites' ) }
							</h2>
							<p className="text-gray-900 text-m leading-s">
								{ __(
									'Quickly generate a publicly accessible URL that you can share with clients and colleagues.'
								) }
							</p>
							<div className="mt-4">
								<button
									onClick={ () =>
										handleClick( 'https://wordpress.com/blog/2025/02/24/studio-preview-sites/' )
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
					image: (
						<img
							src={ previewSitesIllustration } //TODO: Add the correct illustration
							alt=""
							className="h-[173px] w-full object-cover mb-4"
						/>
					),
					content: (
						<div className="px-8 py-4">
							<h2 className="text-xl mb-4 text-gray-900">
								{ __( 'Edit domain names for exisiting sites' ) }
							</h2>
							<p className="text-gray-900 text-m leading-s">
								{ __(
									'Torem ipsum dolor sit amet, consectetur adipiscing elit. Etiam eu turpis molestie, dictum est a, mattis tellus.'
								) }
							</p>
							<div className="mt-4">
								<button
									onClick={
										() =>
											handleClick( 'https://wordpress.com/blog/2025/02/24/studio-preview-sites/' ) //TODO: Add correct link
									}
									className="text-a8c-blueberry text-m leading-s cursor-pointer"
								>
									{ __( 'Learn more' ) }
								</button>
							</div>
						</div>
					),
				},
			] }
		/>
	);
}
