import buildingBlocksIllustration from '@studio/common/assets/whats-new/building-blocks.svg';
import designPickerIllustration from '@studio/common/assets/whats-new/design-picker.svg';
import modelTiersIllustration from '@studio/common/assets/whats-new/model-tiers.svg';
import type { GuideIllustrationId } from '@/data/onboarding/guide';

// Fixed artwork for the What's New pages, shared with the classic renderer's
// modal. Unlike the orientation scenes these are finished images rather than
// built animations, so they're registered separately.
export const WHATS_NEW_ART: Partial< Record< GuideIllustrationId, string > > = {
	'design-picker': designPickerIllustration,
	'model-tiers': modelTiersIllustration,
	'building-blocks': buildingBlocksIllustration,
};
