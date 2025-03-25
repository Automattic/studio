import { Guide } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useState } from 'react';
import versionSwitchIllustration from './assets/version-switch-illustration.svg';

export function WhatsNewModal() {
	const [ isOpen, setIsOpen ] = useState( true );

	if ( ! isOpen ) {
		return null;
	}

	return (
		<Guide
			onFinish={ () => setIsOpen( false ) }
			contentLabel="What's New in Studio"
			className="whats-new-modal !w-[312px] !h-[453px] overflow-hidden"
			pages={ [
				{
					image: (
						<img
							src={ versionSwitchIllustration }
							alt=""
							className="h-[195px] w-full object-cover"
						/>
					),
					content: (
						<div className="p-8">
							<h2 className="text-2xl font-semibold mb-4">
								{ __( 'Select WordPress and PHP versions in Studio' ) }
							</h2>
							<p className="text-gray-600 text-lg">
								{ __(
									'Select your preferred WordPress and PHP versions for existing sites or when creating a new one.'
								) }
							</p>
							<div className="mt-4">
								<a href="#" className="text-[#4741F4] hover:text-[#3732C5]">
									{ __( 'Learn more' ) }
								</a>
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
