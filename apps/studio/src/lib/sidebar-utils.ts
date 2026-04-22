import {
	SIDEBAR_WIDTH,
	SIDEBAR_MIN_WIDTH,
	SIDEBAR_MAX_WIDTH,
	LOCAL_STORAGE_SIDEBAR_WIDTH_KEY,
} from 'src/constants';

export function getSavedSidebarWidth(): number {
	const saved = localStorage.getItem( LOCAL_STORAGE_SIDEBAR_WIDTH_KEY );
	if ( saved ) {
		const parsed = Number( saved );
		if ( ! isNaN( parsed ) && parsed >= SIDEBAR_MIN_WIDTH && parsed <= SIDEBAR_MAX_WIDTH ) {
			return parsed;
		}
	}
	return SIDEBAR_WIDTH;
}
