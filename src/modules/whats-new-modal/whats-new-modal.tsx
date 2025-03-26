import { Guide } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useState } from 'react';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import previewSitesIllustration from './assets/preview-sites-illustration.svg';
import versionSwitchIllustration from './assets/version-switch-illustration.svg';

interface WhatsNewPage {
	image: string;
	title: string;
	description: string;
	learnMoreUrl: string;
}

const WHATS_NEW_PAGES: WhatsNewPage[] = [
	{
		image: versionSwitchIllustration,
		title: __( 'Select WordPress and PHP versions in Studio' ),
		description: __(
			'Select your preferred WordPress and PHP versions for existing sites or when creating a new one.'
		),
		learnMoreUrl: 'https://wordpress.com/blog/2025/03/17/studio-wordpress-php-versions/',
	},
	{
		image: previewSitesIllustration,
		title: __( 'Share your work easily with Preview sites' ),
		description: __(
			'Quickly generate a publicly accessible URL that you can share with clients and colleagues.'
		),
		learnMoreUrl: 'https://wordpress.com/blog/2025/02/24/studio-preview-sites/',
	},
	{
		image: previewSitesIllustration, // TODO: Add correct illustration
		title: __( 'Edit domain names for exisiting sites' ),
		description: __(
			'Torem ipsum dolor sit amet, consectetur adipiscing elit. Etiam eu turpis molestie, dictum est a, mattis tellus.'
		),
		learnMoreUrl: 'https://wordpress.com/blog/2025/02/24/studio-preview-sites/', // TODO: Add correct URL
	},
];

const PageContent = ( { title, description, learnMoreUrl }: Omit< WhatsNewPage, 'image' > ) => (
	<div className="px-8 py-4">
		<h2 className="text-xl mb-4 text-gray-900">{ title }</h2>
		<p className="text-gray-900 text-m leading-s">{ description }</p>
		<div className="mt-4">
			<button
				onClick={ () => getIpcApi().openURL( learnMoreUrl ) }
				className="text-a8c-blueberry text-m leading-s cursor-pointer"
			>
				{ __( 'Learn more' ) }
			</button>
		</div>
	</div>
);

export function WhatsNewModal() {
	const [ isOpen, setIsOpen ] = useState( true );

	if ( ! isOpen ) {
		return null;
	}

	return (
		<Guide
			onFinish={ () => setIsOpen( false ) }
			contentLabel={ __( "What's New in Studio" ) }
			className={ cx(
				"whats-new-modal !w-[312px] !h-[470px] overflow-hidden [&_button[aria-label='Close']_svg]:fill-white"
			) }
			pages={ WHATS_NEW_PAGES.map( ( { image, ...pageContent } ) => ( {
				image: <img src={ image } alt="" className="h-[173px] w-full object-cover mb-4" />,
				content: <PageContent { ...pageContent } />,
			} ) ) }
			finishButtonText={ __( 'Done' ) }
		/>
	);
}
