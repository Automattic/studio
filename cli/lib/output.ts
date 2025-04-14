// eslint-disable-next-line import/no-named-as-default
import Table from 'cli-table3';
import {
	addDays,
	addHours,
	DurationUnit,
	format,
	formatDuration,
	intervalToDuration,
} from 'date-fns';
import { HOUR_MS, DAY_MS } from 'src/constants';
import { Snapshot } from 'cli/lib/appdata';

function formatDate( date: string | number | Date ) {
	return format( date, 'MMM d, yyyy, HH:mm' );
}

function formatDurationUntilExpiry( lastUpdatedAt: number ) {
	const MAX_AGE_IN_DAYS = 7;
	const now = new Date();
	const endDate = addDays( lastUpdatedAt, MAX_AGE_IN_DAYS );
	const difference = endDate.getTime() - now.getTime();
	let format: DurationUnit[] = [ 'days', 'hours' ];

	if ( difference < HOUR_MS ) {
		format = [ 'minutes' ];
	} else if ( difference < DAY_MS ) {
		format = [ 'hours', 'minutes' ];
	}

	if ( endDate < now ) {
		return 'Expired';
	}

	return formatDuration(
		intervalToDuration( {
			start: now,
			end: addHours( endDate, 1 ),
		} ),
		{
			format,
			delimiter: ', ',
		}
	);
}

export function getSnapshotCliTable( snapshots: Snapshot[] ) {
	const table = new Table( {
		head: [ 'URL', 'Site Name', 'Updated', 'Expires in' ],
		style: {
			head: [],
			border: [],
		},
	} );

	snapshots.forEach( ( snapshot ) => {
		const durationUntilExpiry = formatDurationUntilExpiry( snapshot.date );

		table.push( [
			`https://${ snapshot.url }`,
			snapshot.name,
			formatDate( snapshot.date ),
			durationUntilExpiry,
		] );
	} );

	return table;
}
