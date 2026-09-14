import cliIllustration from '@studio/common/assets/whats-new/cli.svg';
import darkModeIllustration from '@studio/common/assets/whats-new/dark-mode.svg';
import nativePhpIllustration from '@studio/common/assets/whats-new/native-php.svg';
import phpMyAdminIllustration from '@studio/common/assets/whats-new/phpmyadmin.svg';
import studioCodeIllustration from '@studio/common/assets/whats-new/studio-code.svg';
import type { GuideIllustrationId } from '@/data/onboarding/guide';

// Fixed artwork for the What's New pages, shared with the classic renderer's
// modal. Unlike the orientation scenes these are finished images rather than
// built animations, so they're registered separately.
export const WHATS_NEW_ART: Partial< Record< GuideIllustrationId, string > > = {
	'studio-code': studioCodeIllustration,
	'native-php': nativePhpIllustration,
	'dark-mode': darkModeIllustration,
	phpmyadmin: phpMyAdminIllustration,
	cli: cliIllustration,
};
