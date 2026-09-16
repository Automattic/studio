import { __ } from '@wordpress/i18n';
import type { GuideDefinition } from './guide';

// Keep these pages in step with the classic renderer's modal
// (apps/studio/src/modules/whats-new/components/whats-new-modal.tsx) — both are
// gated by the same FORCE_SHOW_WHATS_NEW switch in @studio/common.

export function getWhatsNewGuide(): GuideDefinition {
	return {
		pages: [
			{
				illustration: 'model-tiers',
				title: () => __( 'Fast, Balanced, or Strong' ),
				description: () =>
					__(
						'Model names are gone. Pick the speed and depth you need instead: Fast for everyday changes, Balanced and Strong for bigger builds when you have AI credits.'
					),
				action: () => __( 'Next' ),
			},
			{
				illustration: 'design-picker',
				title: () => __( 'Pick your design before a line of code' ),
				description: () =>
					__(
						'Start a site with a short brief, then choose from four looks and four layouts drawn as real previews. Studio Code builds the one you pick.'
					),
				action: () => __( 'Next' ),
				learnMore: 'docsStudioCode',
			},
			{
				illustration: 'design-system',
				title: () => __( 'Your design sticks around' ),
				description: () =>
					__(
						"The look you choose is saved as your site's design system, so every later change — colors, type, even the writing voice — stays in keeping with it."
					),
				action: () => __( 'Next' ),
				learnMore: 'docsStudioCode',
			},
			{
				illustration: 'building-blocks',
				title: () => __( 'Sites you can keep editing yourself' ),
				description: () =>
					__(
						'Studio Code now styles with theme settings and block styles instead of custom CSS, so you can adjust colors, fonts, and sections right in the Site Editor.'
					),
				action: () => __( 'Done' ),
			},
		],
	};
}
