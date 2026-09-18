import buildingBlocksIllustration from '@studio/common/assets/whats-new/building-blocks.svg';
import designPickerIllustration from '@studio/common/assets/whats-new/design-picker.svg';
import modelTiersIllustration from '@studio/common/assets/whats-new/model-tiers.svg';
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
			image: modelTiersIllustration,
			title: __( 'Fast, Balanced, or Strong' ),
			description: __(
				'Model names are gone. Pick the speed and depth the job needs instead — and get more done with your AI credits, because Fast handles everyday changes at a fraction of the cost.'
			),
		},
		{
			image: designPickerIllustration,
			title: __( 'Pick your design before a line of code' ),
			description: __(
				'Start a site with a short brief, then choose from four looks and four layouts drawn as real previews. The one you pick becomes your design system, so everything built later stays in keeping with it.'
			),
			learnMoreUrl: getLocalizedLink( locale, 'docsStudioCode' ),
		},
		{
			image: buildingBlocksIllustration,
			title: __( 'Sites you can keep editing yourself' ),
			description: __(
				'Studio Code now styles with theme settings and block styles instead of custom CSS, so you can adjust colors, fonts, and sections right in the Site Editor.'
			),
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
