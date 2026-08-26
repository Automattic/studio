import interpolateComponents from '@automattic/interpolate-components';
import cliIllustration from '@studio/common/assets/whats-new/cli.svg';
import darkModeIllustration from '@studio/common/assets/whats-new/dark-mode.svg';
import nativePhpIllustration from '@studio/common/assets/whats-new/native-php.svg';
import phpMyAdminIllustration from '@studio/common/assets/whats-new/phpmyadmin.svg';
import studioCodeIllustration from '@studio/common/assets/whats-new/studio-code.svg';
import { Guide } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { ReactNode } from 'react';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { getLocalizedLink } from 'src/lib/get-localized-link';
import { useI18nLocale } from 'src/stores';

interface WhatsNewPage {
	image: string;
	title: string;
	description: ReactNode;
	learnMoreUrl?: string;
	learnMoreLabel?: string;
}

interface WhatsNewModalProps {
	showModal: boolean;
	onClose: () => void;
}

const PageContent = ( {
	title,
	description,
	learnMoreUrl,
	learnMoreLabel,
}: Omit< WhatsNewPage, 'image' > ) => (
	<div className="px-8 pt-3 pb-2 flex flex-col h-full">
		<h2 className="text-xl mb-2 text-frame-text line-clamp-2">{ title }</h2>
		<p className="text-frame-text text-m leading-s line-clamp-5">{ description }</p>
		<div className="mt-2 mb-4">
			{ learnMoreUrl && (
				<button
					onClick={ () => getIpcApi().openURL( learnMoreUrl ) }
					className="text-frame-theme text-m leading-s cursor-pointer"
				>
					{ learnMoreLabel || __( 'Learn more' ) }
				</button>
			) }
		</div>
	</div>
);

export default function WhatsNewModal( { showModal, onClose }: WhatsNewModalProps ) {
	const locale = useI18nLocale();
	const whatsNewPages: WhatsNewPage[] = [
		{
			image: studioCodeIllustration,
			title: __( 'Studio Code helps you get it done' ),
			description: __(
				'From quick edits to new features, Studio Code helps you move faster by translating your ideas into working code.'
			),
			learnMoreUrl: getLocalizedLink( locale, 'docsStudioCode' ),
		},
		{
			image: nativePhpIllustration,
			title: __( 'Faster local sites with native PHP' ),
			description: __(
				'Studio now uses native PHP by default, running WordPress with fewer abstractions for better performance. You can switch between Native and Sandbox runtimes in your site settings.'
			),
			learnMoreUrl: getLocalizedLink( locale, 'docsPhpRuntimes' ),
		},
		{
			image: darkModeIllustration,
			title: __( 'Dark mode is here' ),
			description: __(
				'Studio now supports light, dark, and system appearance modes. Head to Settings to choose your preferred look.'
			),
		},
		{
			image: phpMyAdminIllustration,
			title: __( 'Manage your database with phpMyAdmin' ),
			description: __(
				"Studio now includes phpMyAdmin, giving you a visual interface to manage your site's database. Access it from the Overview tab."
			),
		},
		{
			image: cliIllustration,
			title: __( 'WP-CLI support and CLI site management' ),
			description: interpolateComponents( {
				mixedString: sprintf(
					/* translators: %s is the name of the WordPress Studio CLI command ("studio") */
					__(
						'Easily install the %s CLI to run WP-CLI commands from your terminal and create, start, stop, or update your sites.'
					),
					'{{code}}studio{{/code}}'
				),
				components: {
					code: <code />,
				},
			} ),
			learnMoreUrl: getLocalizedLink( locale, 'docsCli' ),
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
				'whats-new-modal !w-[360px] !h-[470px] overflow-hidden [&_.components-button.is-compact.has-icon_svg]:!fill-white [&_.components-button.is-tertiary]:!outline-1 [&_.components-button.is-tertiary]:!outline-solid [&_.components-button.is-tertiary]:!outline-frame-theme',
				'[&_*]:select-none',
				'focus:outline-none'
			) }
			pages={ whatsNewPages.map( ( { image, title, ...pageContent } ) => ( {
				image: (
					<div className="relative">
						<div className="absolute top-[13px] left-[13px] rtl:left-auto rtl:right-[13px] bg-a8c-gray-90 text-a8c-gray-5 text-xs px-2 py-1 rounded-sm">
							{ __( "What's new" ) }
						</div>
						<img
							src={ image }
							alt={ sprintf( __( 'Illustration for %s' ), title ) }
							className="h-[195px] w-full object-cover mb-3"
						/>
					</div>
				),
				content: <PageContent title={ title } { ...pageContent } />,
			} ) ) }
			finishButtonText={ __( 'Done' ) }
			nextButtonText={ __( 'Next' ) }
			previousButtonText={ __( 'Previous' ) }
		/>
	);
}
