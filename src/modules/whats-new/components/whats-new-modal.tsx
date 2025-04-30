import interpolateComponents from '@automattic/interpolate-components';
import { Guide } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { ReactNode } from 'react';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import cliIllustration from 'src/modules/whats-new/assets/cli-illustration.svg';
import customDomainIllustration from 'src/modules/whats-new/assets/custom-domains-illustration.svg';
import previewSitesIllustration from 'src/modules/whats-new/assets/preview-sites-illustration.svg';
import studioIllustration from 'src/modules/whats-new/assets/studio-illustration.svg';
import versionSwitchIllustration from 'src/modules/whats-new/assets/version-switch-illustration.svg';
import 'src/index.css';

interface WhatsNewPage {
	image: string;
	title: string;
	description: ReactNode;
	learnMoreUrl?: string;
}

interface WhatsNewModalProps {
	showModal: boolean;
	onClose: () => void;
}

const PageContent = ( {
	title,
	description,
	learnMoreUrl,
	isIntroPage = false,
}: Omit< WhatsNewPage, 'image' > & { isIntroPage?: boolean } ) => (
	<div className="px-8 pt-3 pb-2 flex flex-col h-full">
		<h2 className="text-xl mb-2 text-gray-900 line-clamp-2">{ title }</h2>
		<p
			className={ cx(
				'text-gray-900 text-m leading-s',
				isIntroPage ? 'line-clamp-5' : 'line-clamp-3'
			) }
		>
			{ description }
		</p>
		<div className="mt-2 mb-4">
			{ learnMoreUrl && (
				<button
					onClick={ () => getIpcApi().openURL( learnMoreUrl ) }
					className="text-a8c-blueberry text-m leading-s cursor-pointer"
				>
					{ __( 'Learn more' ) }
				</button>
			) }
		</div>
	</div>
);

export default function WhatsNewModal( { showModal, onClose }: WhatsNewModalProps ) {
	const whatsNewPages: WhatsNewPage[] = [
		{
			image: studioIllustration,
			title: __( 'What is new in Studio?' ),
			description: __(
				'Discover the latest updates in Studio! Explore exciting new features designed to enhance your experience.'
			),
		},
		{
			image: cliIllustration,
			title: __( 'Introducing Studio CLI' ),
			description: interpolateComponents( {
				mixedString: sprintf(
					/* translators: %s is the name of the Studio CLI command ("studio") */
					__(
						'Run the %s command in your terminal to create, list, update, and delete preview sites with our new CLI tool.'
					),
					'{{code}}studio{{/code}}'
				),
				components: {
					code: <code />,
				},
			} ),
			learnMoreUrl: 'https://developer.wordpress.com/docs/developer-tools/studio/cli/',
		},
		{
			image: customDomainIllustration,
			title: __( 'Choose a custom domain with HTTPS support' ),
			description: __(
				'Easily identify your local Studio sites with custom domain names. Personalize and organize your workflow!'
			),
			learnMoreUrl: 'https://wordpress.com/blog/2025/03/31/studio-custom-domains-https/',
		},
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
	];

	if ( ! showModal ) {
		return null;
	}

	return (
		<Guide
			onFinish={ onClose }
			contentLabel={ __( "What's New in Studio" ) }
			className={ cx(
				"whats-new-modal !w-[360px] !h-[470px] overflow-hidden [&_button[aria-label='Close']_svg]:fill-white [&_.components-button.is-tertiary]:!outline-1 [&_.components-button.is-tertiary]:!outline-solid [&_.components-button.is-tertiary]:!outline-a8c-blueberry",
				'[&_*]:select-none',
				'focus:outline-none'
			) }
			pages={ whatsNewPages.map( ( { image, title, ...pageContent }, index ) => ( {
				image: (
					<img
						src={ image }
						alt={ sprintf( __( 'Illustration for %s' ), title ) }
						className="h-[195px] w-full object-cover mb-3"
					/>
				),
				content: (
					<div className={ index === 0 ? 'whats-new-intro-page' : '' }>
						<PageContent title={ title } { ...pageContent } isIntroPage={ index === 0 } />
					</div>
				),
			} ) ) }
			finishButtonText={ __( 'Done' ) }
		/>
	);
}
