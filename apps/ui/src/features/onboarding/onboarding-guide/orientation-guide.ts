import { __ } from '@wordpress/i18n';
import type { GuideDefinition, GuidePage } from './guide';

// Bump to re-show the orientation guide to everyone who saw the previous
// version (compared against OnboardingHintsState.tourCompletedVersion /
// tourDismissedVersion — the field names predate the modal and stay generic).
export const ORIENTATION_GUIDE_VERSION = 2;

// The copy differs only by whether the user is coming from classic Studio or
// is on a fresh install (page 1 only, see the Welcome Tour Figma).
export interface OrientationVariant {
	migrating: boolean;
}

// Page 1 — the sidebar. Differs only by new vs migrating; a migrating user gets
// reassured their existing sites carried over.
function sitesPage( migrating: boolean ): GuidePage {
	if ( migrating ) {
		return {
			illustration: 'sites',
			title: () => __( 'Welcome to WordPress Studio 2.0' ),
			description: () =>
				__(
					'Everything you built in WordPress Studio is right here in the sidebar. Same sites, same files with a new workbench around them.'
				),
			action: () => __( 'Next' ),
		};
	}
	return {
		illustration: 'sites',
		title: () => __( 'Welcome to WordPress Studio' ),
		description: () =>
			/* translators: "on the left" describes the sidebar in left-to-right layouts; in right-to-left languages it sits on the right — adapt the direction accordingly. */
			__(
				'Every site you build lives in the sidebar on the left. Switch between them anytime. The sidebar is where you’ll find site settings and a quick way to start and stop your site.'
			),
		action: () => __( 'Next' ),
	};
}

// Page 2 — building with Studio Code.
function chatPage(): GuidePage {
	return {
		illustration: 'chat',
		title: () => __( 'Build by asking' ),
		description: () =>
			__(
				'Describe what you want in plain language. Add a page, change the design, fix a bug — and our AI agent, Studio Code, builds it.'
			),
		action: () => __( 'Next' ),
	};
}

// Page 3 — the live preview, refreshing as Studio Code edits the site.
function previewPage(): GuidePage {
	return {
		illustration: 'preview',
		title: () => __( 'See your site update in realtime' ),
		description: () =>
			/* translators: "on the right" describes the preview in left-to-right layouts; in right-to-left languages it sits on the left — adapt the direction accordingly. */
			__(
				'Your site is shown on the right, automatically refreshing as you make changes with Studio Code. Switch between the front-end, wp-admin, and the database from the toolbar.'
			),
		action: () => __( 'Let’s go' ),
	};
}

export function getOrientationGuide( { migrating }: OrientationVariant ): GuideDefinition {
	return {
		pages: [ sitesPage( migrating ), chatPage(), previewPage() ],
	};
}
