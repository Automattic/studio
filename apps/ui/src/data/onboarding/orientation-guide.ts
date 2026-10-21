import { __ } from '@wordpress/i18n';
import type { GuideDefinition, GuidePage } from './guide';

// Bump to re-show the orientation guide to everyone who saw the previous
// version (compared against OnboardingHintsState.tourCompletedVersion /
// tourDismissedVersion — the field names predate the modal and stay generic).
export const ORIENTATION_GUIDE_VERSION = 2;

// Two independent axes drive the copy (see the Welcome Tour Figma):
//   migrating   — coming from classic Studio vs a fresh install (page 1 only)
//   chatEnabled — whether Studio Code (chat) is on offer (the chat page and the
//                 preview copy). The design labels this "signed in", but
//                 signed-out, offline, and opted-out (Settings → AI) all
//                 collapse to the non-chat tour.
export interface OrientationVariant {
	migrating: boolean;
	chatEnabled: boolean;
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
					'Everything you built in Studio is right here in the sidebar. Same sites, same files with a new workbench around them.'
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

// Page 2 — building with Studio Code, only when chat is on offer.
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

// Page 3 — the live preview. Signed-in copy calls out the realtime refresh that
// comes with Studio Code edits; signed-out copy is the plain preview.
function previewPage( chatEnabled: boolean ): GuidePage {
	if ( chatEnabled ) {
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
	return {
		illustration: 'preview',
		title: () => __( 'See your site inline' ),
		description: () =>
			/* translators: "on the right" describes the preview in left-to-right layouts; in right-to-left languages it sits on the left — adapt the direction accordingly. */
			__(
				'Your site is shown on the right. Switch between the front-end, wp-admin, and the database from the toolbar.'
			),
		action: () => __( 'Let’s go' ),
	};
}

export function getOrientationGuide( {
	migrating,
	chatEnabled,
}: OrientationVariant ): GuideDefinition {
	return {
		pages: chatEnabled
			? [ sitesPage( migrating ), chatPage(), previewPage( chatEnabled ) ]
			: [ sitesPage( migrating ), previewPage( chatEnabled ) ],
	};
}
