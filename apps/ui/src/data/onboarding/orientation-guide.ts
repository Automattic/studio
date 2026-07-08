import { __ } from '@wordpress/i18n';

// Bump to re-show the orientation guide to everyone who saw the previous
// version (compared against OnboardingHintsState.tourCompletedVersion /
// tourDismissedVersion — the field names predate the modal and stay generic).
export const ORIENTATION_GUIDE_VERSION = 1;

export type OrientationVariant = 'agentic' | 'overview';

export type OrientationIllustrationId = 'sites' | 'chat' | 'preview' | 'overview';

export interface GuidePage {
	illustration: OrientationIllustrationId;
	title: () => string;
	description: () => string;
	// The advance button's label — the user's reaction to this page ("Cool",
	// "Wait, really?"), not a generic "Next".
	action: () => string;
}

export interface GuideDefinition {
	id: OrientationVariant;
	version: number;
	pages: GuidePage[];
}

const SITES_PAGE: GuidePage = {
	illustration: 'sites',
	title: () => __( 'Welcome to your workbench' ),
	description: () =>
		__(
			'Every site you build lives in the sidebar on the left. Switch between them anytime — each keeps its own history.'
		),
	action: () => __( 'Cool' ),
};

// Final page in both variants, so its action closes the guide.
const PREVIEW_PAGE: GuidePage = {
	illustration: 'preview',
	title: () => __( 'See it live' ),
	description: () =>
		__(
			'Your site previews on the right and updates as changes land. Switch between the front end, WP Admin, and the database from the toolbar.'
		),
	action: () => __( 'Let’s go' ),
};

// Agentic variant: the user lands in a chat session, so the middle beat is the
// agent. Ends on the preview so the connection between asking and seeing is
// the last thing they read before their first prompt.
export const AGENTIC_ORIENTATION_GUIDE: GuideDefinition = {
	id: 'agentic',
	version: ORIENTATION_GUIDE_VERSION,
	pages: [
		SITES_PAGE,
		{
			illustration: 'chat',
			title: () => __( 'Build by asking' ),
			description: () =>
				__(
					'Describe what you want in plain language — add a page, change the design, fix a bug — and the agent builds it. Start from a suggestion or just type.'
				),
			action: () => __( 'Wait, really?' ),
		},
		PREVIEW_PAGE,
	],
};

// Non-agentic variant: no chat. The middle beat is the site overview and its
// customize/manage tools.
export const OVERVIEW_ORIENTATION_GUIDE: GuideDefinition = {
	id: 'overview',
	version: ORIENTATION_GUIDE_VERSION,
	pages: [
		SITES_PAGE,
		{
			illustration: 'overview',
			title: () => __( 'Manage your site' ),
			description: () =>
				__(
					'The site overview is your control panel — open the editor and admin tools, or duplicate, export, and manage your site from one place.'
				),
			action: () => __( 'That’s handy' ),
		},
		PREVIEW_PAGE,
	],
};

export function getOrientationGuide( variant: OrientationVariant ): GuideDefinition {
	return variant === 'agentic' ? AGENTIC_ORIENTATION_GUIDE : OVERVIEW_ORIENTATION_GUIDE;
}
