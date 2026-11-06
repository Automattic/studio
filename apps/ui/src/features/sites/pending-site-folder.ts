import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPendingSlot } from '@/lib/pending-slot';
import type { SelectedSiteFolder } from '@/data/core';

export const pendingSiteFolderSlot = createPendingSlot< SelectedSiteFolder >();

export function usePendingSiteFolder() {
	const pending = useSyncExternalStore(
		pendingSiteFolderSlot.subscribe,
		pendingSiteFolderSlot.getSnapshot
	);
	const [ selected, setSelected ] = useState( pending );
	useEffect( () => {
		if ( ! pending ) return;
		setSelected( pending );
		pendingSiteFolderSlot.clear( pending );
	}, [ pending ] );
	return selected ?? undefined;
}
