import { __ } from '@wordpress/i18n';
import { PanelsTopLeftIcon } from 'lucide-react';
import { IntelligenceIcon, ShareIcon } from '@/lib/icons';
import type { IntroFeature } from '@/features/onboarding/intro-content';

// Increment for a new announcement, not for changes to its presentation.
export const WHATS_NEW_VERSION = 1;

export interface WhatsNewContent {
	features: IntroFeature[];
	learnMoreUrl?: string;
}

export function getWhatsNewContent(): WhatsNewContent {
	return {
		features: [
			{
				icon: <PanelsTopLeftIcon />,
				title: __( 'A new workspace for your sites' ),
				description: __(
					'Your sites and chats share one sidebar. Keep your conversation and live preview side by side.'
				),
			},
			{
				icon: <IntelligenceIcon />,
				title: __( 'Build with Studio Code' ),
				description: __( 'Ask for a change and see it take shape in your site’s preview.' ),
			},
			{
				icon: <ShareIcon />,
				title: __( 'Publish and share' ),
				description: __(
					'Publish replaces Sync for pushing and pulling changes. Share lets anyone try your site with a preview link.'
				),
			},
		],
	};
}
