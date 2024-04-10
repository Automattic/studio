// To run tests, execute `npm run test -- src/hooks/tests/use-expiration-date.test.ts` from the root directory
import { renderHook } from '@testing-library/react';
import { subDays, subHours, subMinutes, subMilliseconds } from 'date-fns';
import { useExpirationDate } from '../use-expiration-date';

describe( 'useExpirationDate', () => {
	test( 'should indicate isExpired for dates more than 7 days', () => {
		const snapshotDate = subDays( new Date(), 8 ).getTime(); // More than 7 days
		const { result } = renderHook( () => useExpirationDate( snapshotDate ) );
		expect( result.current.isExpired ).toBeTruthy();
		expect( result.current.countDown ).toBe( 'Expired' );
	} );

	test( 'should show correct countdown for dates within 7 days', () => {
		const snapshotDate = subHours( subDays( new Date(), 2 ), 1 ).getTime();
		const { result } = renderHook( () => useExpirationDate( snapshotDate ) );
		expect( result.current.isExpired ).toBeFalsy();
		expect( result.current.countDown ).toBe( '4 days, 23 hours' );
	} );

	test( 'should extend countdown day for the first hour', () => {
		const snapshotDate = subMinutes( new Date().getTime(), 5 ).getTime();
		const { result } = renderHook( () => useExpirationDate( snapshotDate ) );
		expect( result.current.isExpired ).toBeFalsy();
		expect( result.current.countDown ).toBe( '7 days' );
	} );

	test( 'should switch to hours and minutes format within 24 hours to expiration', () => {
		const snapshotDate = subMilliseconds( subHours( subDays( new Date(), 6 ), 12 ), 100 ).getTime();
		const { result } = renderHook( () => useExpirationDate( snapshotDate ) );
		expect( result.current.countDown ).toBe( '12 hours, 59 minutes' );
	} );
	test( 'should switch to minutes and seconds format within the last hour before expiration', () => {
		const snapshotDate = subHours( subDays( new Date(), 6 ), 23 ).getTime() - 1;
		const { result } = renderHook( () => useExpirationDate( snapshotDate ) );
		expect( result.current.countDown ).toBe( '59 minutes' );
	} );
} );
