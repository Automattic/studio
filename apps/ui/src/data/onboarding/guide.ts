import type { DocsLinkKey } from '@/lib/docs-links';

// The shape both paged guides share: the first-run orientation tour
// (orientation-guide.ts) and the per-release announcements (whats-new.ts).
// Rendered by components/onboarding-guide.

export type GuideIllustrationId =
	// Orientation.
	| 'sites'
	| 'chat'
	| 'preview'
	| 'overview'
	// What's New.
	| 'studio-code'
	| 'native-php'
	| 'dark-mode'
	| 'phpmyadmin'
	| 'cli';

export interface GuidePage {
	illustration: GuideIllustrationId;
	// Thunks, not strings: the pages are built once per open but the locale can
	// change under them, so translation happens at render time.
	title: () => string;
	description: () => string;
	// The advance button's label.
	action: () => string;
	learnMore?: DocsLinkKey;
}

export interface GuideDefinition {
	pages: GuidePage[];
}
