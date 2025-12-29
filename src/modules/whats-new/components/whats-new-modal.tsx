import interpolateComponents from '@automattic/interpolate-components';
import { Guide } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { ReactNode } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { getLocalizedLink } from 'src/lib/get-localized-link';
import blueprintsIllustration from 'src/modules/whats-new/assets/blueprints-illustration.svg';
import cliIllustration from 'src/modules/whats-new/assets/cli-illustration.svg';
import pressableSyncIllustration from 'src/modules/whats-new/assets/pressable-sync-illustration.svg';
import selectiveSyncIllustration from 'src/modules/whats-new/assets/selective-sync-illustration.svg';
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
					className="text-a8c-blue-50 text-m leading-s cursor-pointer"
				>
					{ learnMoreLabel || (
						<>
							{ __( 'Learn more' ) }
							<ArrowIcon />
						</>
					) }
				</button>
			) }
		</div>
	</div>
);

export default function WhatsNewModal( { showModal, onClose }: WhatsNewModalProps ) {
	const locale = useI18nLocale();
	const whatsNewPages: WhatsNewPage[] = [
		{
			image: blueprintsIllustration,
			title: __( 'Introducing Blueprints, a new way to streamline site creation.' ),
			description: __(
				'Select a Blueprint that fits your needs and build your WordPress site even faster.'
			),
			learnMoreUrl: getLocalizedLink( locale, 'docsBlueprints' ),
		},
		{
			image: selectiveSyncIllustration,
			title: __( 'Synchronize with precision' ),
			description: __(
				'Synchronize specific plugins, themes, or the database for fast, precise updates to your WordPress.com or Pressable sites.'
			),
			learnMoreUrl: `${ getLocalizedLink( locale, 'docsSync' ) }#pull`,
		},
		{
			image: pressableSyncIllustration,
			title: __( 'Sync to your favorite host' ),
			description: __(
				'Pull and push your Studio sites to WordPress.com or Pressable with a single click. No more manual uploads or FTP transfers!'
			),
			learnMoreUrl: getLocalizedLink( locale, 'docsSync' ),
		},
		{
			image: cliIllustration,
			title: __( 'Introducing Studio CLI' ),
			description: interpolateComponents( {
				mixedString: sprintf(
					/* translators: %s is the name of the WordPress Studio CLI command ("studio") */
					__(
						'Run the %s command in your terminal to create, list, update, and delete preview sites with our new CLI tool.'
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
				'whats-new-modal !w-[360px] !h-[470px] overflow-hidden [&_.components-button.is-compact.has-icon_svg]:!fill-white [&_.components-button.is-tertiary]:!outline-1 [&_.components-button.is-tertiary]:!outline-solid [&_.components-button.is-tertiary]:!outline-a8c-blue-50',
				'[&_*]:select-none',
				'focus:outline-none'
			) }
			pages={ whatsNewPages.map( ( { image, title, ...pageContent }, index ) => ( {
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
				content: (
					<div className={ index === 0 ? 'whats-new-intro-page' : '' }>
						<PageContent title={ title } { ...pageContent } isIntroPage={ index === 0 } />
					</div>
				),
			} ) ) }
			finishButtonText={ __( 'Done' ) }
			nextButtonText={ __( 'Next' ) }
			previousButtonText={ __( 'Previous' ) }
		/>
	);
}
