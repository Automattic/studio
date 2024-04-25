import { useI18n } from '@wordpress/react-i18n';
import { intervalToDuration, formatDuration, addDays, Duration, addHours, Locale } from 'date-fns';
import {
	es,
	ar,
	de,
	enUS,
	fr,
	he,
	id,
	it,
	ja,
	ko,
	nl,
	pl,
	pt,
	ru,
	sv,
	tr,
	zhCN,
	zhTW,
} from 'date-fns/locale';

const HOUR = 1000 * 60 * 60;
const DAY = HOUR * 24;

function formatStringDate( ms: number ): string {
	const { locale = 'en' } = window?.appGlobals || {};
	const formatter = new Intl.DateTimeFormat( locale, {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
	} );
	return formatter.format( new Date( ms ) );
}

interface LocaleMapping {
	[ key: string ]: Locale;
}

const localeMapping: LocaleMapping = {
	es: es,
	ar: ar,
	de: de,
	en: enUS,
	fr: fr,
	he: he,
	id: id,
	it: it,
	ja: ja,
	ko: ko,
	nl: nl,
	pl: pl,
	pt: pt,
	ru: ru,
	sv: sv,
	tr: tr,
	'zh-CN': zhCN,
	'zh-TW': zhTW,
};

function selectDateFnsLocale( locale: string ) {
	return localeMapping[ locale ] || enUS;
}

export function useExpirationDate( snapshotDate: number ) {
	const { __ } = useI18n();
	const MAX_DAYS = 7;
	const now = new Date();
	const endDate = addDays( snapshotDate, MAX_DAYS );
	const difference = endDate.getTime() - now.getTime();
	let isExpired = false;
	let format: ( keyof Duration )[] = [ 'days', 'hours' ];
	if ( difference < 0 ) {
		isExpired = true;
	} else if ( difference < HOUR ) {
		format = [ 'minutes' ];
	} else if ( difference < DAY ) {
		format = [ 'hours', 'minutes' ];
	}

	const { locale } = window?.appGlobals || {};

	const countDown = formatDuration(
		intervalToDuration( {
			start: now,
			// Add 1 hour to the end date serves us here, as for the last hour
			// we show the minutes left.
			end: addHours( endDate, 1 ),
		} ),
		{ format, delimiter: ', ', locale: selectDateFnsLocale( locale ) }
	);
	return {
		isExpired,
		countDown: isExpired ? __( 'Expired' ) : countDown,
		dateString: formatStringDate( snapshotDate ),
	};
}
