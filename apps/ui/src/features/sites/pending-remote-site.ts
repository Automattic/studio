import { createPendingSlot } from '@/lib/pending-slot';

// A WordPress.com or Pressable site a `pull-site` link asked to pull into a new local site.
export const pendingRemoteSiteSlot = createPendingSlot< { remoteSiteId: number } >();
