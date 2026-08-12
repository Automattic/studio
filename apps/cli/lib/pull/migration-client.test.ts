import { describe, expect, it } from 'vitest';
import { snapshotFraction } from './migration-client';

describe( 'snapshotFraction', () => {
	it( 'derives the fraction from file counters', () => {
		expect( snapshotFraction( { downloadedFiles: 42, totalFiles: 84 } ) ).toBe( 0.5 );
	} );

	it( 'falls back to bytes when file totals are absent', () => {
		expect( snapshotFraction( { downloadedBytes: 25, totalBytes: 100 } ) ).toBe( 0.25 );
	} );

	it( 'falls back to statements while the database is being applied', () => {
		expect( snapshotFraction( { statementsExecuted: 3, statementsTotal: 4 } ) ).toBe( 0.75 );
	} );

	it( 'prefers files over bytes when reprint reports both', () => {
		expect(
			snapshotFraction( {
				downloadedFiles: 1,
				totalFiles: 10,
				downloadedBytes: 90,
				totalBytes: 100,
			} )
		).toBe( 0.1 );
	} );

	it( 'returns undefined when nothing is countable, so the bar holds its band start', () => {
		expect( snapshotFraction( {} ) ).toBeUndefined();
		expect( snapshotFraction( { phase: 'streaming' } ) ).toBeUndefined();
		expect( snapshotFraction( { downloadedFiles: 5 } ) ).toBeUndefined();
	} );

	it( 'ignores a zero total rather than dividing by it', () => {
		expect( snapshotFraction( { downloadedFiles: 0, totalFiles: 0 } ) ).toBeUndefined();
	} );
} );
