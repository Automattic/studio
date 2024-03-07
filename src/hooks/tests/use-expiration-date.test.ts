// To run tests, execute `npm run test -- src/hooks/use-expiration-date.test.ts` from the root directory
import { renderHook } from '@testing-library/react';
import { subDays, subHours } from 'date-fns';
import { useExpirationDate } from '../use-expiration-date';

describe( 'useExpirationDate', () => {
	test( 'should indicate isExpired for dates more than 7 days', () => {
		const snapshotDate = subDays( new Date(), 7 ).getTime() + 1; // Mor than 7 days
		const { result } = renderHook( () => useExpirationDate( snapshotDate ) );
		expect( result.current.isExpired ).toBeTruthy();
		expect( result.current.countDown ).toBe( 'Expired' );
	} );

	test( 'should show correct countdown for dates within 7 days', () => {
		const snapshotDate = subDays( new Date(), 2 ).getTime() - 1;
		const { result } = renderHook( () => useExpirationDate( snapshotDate ) );
		expect( result.current.isExpired ).toBeFalsy();
		expect( result.current.countDown ).toBe( '4 days, 23 hours' );
	} );

	test( 'should switch to hours and minutes format within 24 hours to expiration', () => {
		const snapshotDate = subHours( subDays( new Date(), 6 ), 12 ).getTime() - 1;
		const { result } = renderHook( () => useExpirationDate( snapshotDate ) );
		expect( result.current.countDown ).toBe( '11 hours, 59 minutes' );
	} );
	test( 'should switch to minutes and seconds format within the last hour before expiration', () => {
		const snapshotDate = subHours( subDays( new Date(), 6 ), 23 ).getTime() - 1;
		const { result } = renderHook( () => useExpirationDate( snapshotDate ) );
		expect( result.current.countDown ).toBe( '59 minutes' );
	} );
} );
