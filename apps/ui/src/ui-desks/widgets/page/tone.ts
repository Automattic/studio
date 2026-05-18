import type { PageTone } from './types';

export const PAGE_TONE_COLORS: Record< PageTone, string > = {
	neutral: '#14171a',
	orange: '#e86a00',
	red: '#e5484d',
	violet: '#8703e7',
	blue: '#2200e0',
	sky: '#0081f3',
	green: '#00a96c',
};

export function getPageToneDitherFilterId( tone: PageTone ) {
	if ( tone === 'neutral' ) {
		return null;
	}

	return `ui-desks-page-dither-${ PAGE_TONE_COLORS[ tone ].slice( 1 ).toLowerCase() }`;
}
