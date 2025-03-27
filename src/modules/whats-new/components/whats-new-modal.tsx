import { Guide } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import previewSitesIllustration from 'src/modules/whats-new/assets/preview-sites-illustration.svg';
import versionSwitchIllustration from 'src/modules/whats-new/assets/version-switch-illustration.svg';

interface WhatsNewPage {
	image: string;
	title: string;
	description: string;
	learnMoreUrl?: string;
}

interface WhatsNewModalProps {
	showModal: boolean;
	onClose: () => void;
}

const WHATS_NEW_PAGES: WhatsNewPage[] = [
	{
		image: versionSwitchIllustration, // TODO: Add correct illustration for intro card
		title: __( 'What is new in Studio this month?' ),
		description: __(
			'All these fun new features are waiting for you to discover them. Click on the cards below to learn more.'
		),
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
	{
		image: previewSitesIllustration, // TODO: Add correct illustration
		title: __( 'Choose a custom domain for your Studio site' ),
		description: __(
			'Torem ipsum dolor sit amet, consectetur adipiscing elit. Etiam eu turpis molestie, dictum est a, mattis tellus.'
		),
		learnMoreUrl:
			'https://developer.wordpress.com/docs/developer-tools/studio/sites/#1-using-a-custom-domain ', // TODO: Add correct URL
	},
];

const PageContent = ( { title, description, learnMoreUrl }: Omit< WhatsNewPage, 'image' > ) => (
	<div className="px-8 py-4 flex flex-col h-full">
		<h2 className="text-xl mb-4 text-gray-900">{ title }</h2>
		<p className="text-gray-900 text-m leading-s">{ description }</p>
		<div className={ cx( 'mt-4', ! learnMoreUrl && 'mt-[36px]' ) }>
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
	if ( ! showModal ) {
		return null;
	}

	return (
		<Guide
			onFinish={ onClose }
			contentLabel={ __( "What's New in Studio" ) }
			className={ cx(
				"whats-new-modal !w-[312px] !h-[470px] overflow-hidden [&_button[aria-label='Close']_svg]:fill-white [&_.components-button.is-tertiary]:!outline-1 [&_.components-button.is-tertiary]:!outline-solid [&_.components-button.is-tertiary]:!outline-a8c-blueberry",
				'[&_*]:select-none'
			) }
			pages={ WHATS_NEW_PAGES.map( ( { image, title, ...pageContent } ) => ( {
				image: (
					<img
						src={ image }
						alt={ __( `Illustration for ${ title }` ) }
						className="h-[173px] w-full object-cover mb-4"
					/>
				),
				content: <PageContent title={ title } { ...pageContent } />,
			} ) ) }
			finishButtonText={ __( 'Done' ) }
		/>
	);
}
