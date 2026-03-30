import { sequential } from '../sequential';

describe( 'sequential', () => {
	describe( 'concurrency', () => {
		it( 'should limit concurrent executions', async () => {
			let running = 0;
			let maxRunning = 0;
			const fn = sequential(
				async () => {
					running++;
					maxRunning = Math.max( maxRunning, running );
					await new Promise( ( r ) => setTimeout( r, 50 ) );
					running--;
				},
				{ concurrent: 2 }
			);

			await Promise.all( [ fn(), fn(), fn(), fn() ] );
			expect( maxRunning ).toBe( 2 );
		} );

		it( 'should default to 1 concurrent execution', async () => {
			let running = 0;
			let maxRunning = 0;
			const fn = sequential( async () => {
				running++;
				maxRunning = Math.max( maxRunning, running );
				await new Promise( ( r ) => setTimeout( r, 10 ) );
				running--;
			} );

			await Promise.all( [ fn(), fn(), fn() ] );
			expect( maxRunning ).toBe( 1 );
		} );
	} );

	describe( 'max queue size', () => {
		it( 'should reject when queue is full', async () => {
			const fn = sequential(
				async () => {
					await new Promise( ( r ) => setTimeout( r, 100 ) );
				},
				{ concurrent: 1, max: 2 }
			);

			const p1 = fn(); // running
			const p2 = fn(); // queued (1)
			const p3 = fn(); // queued (2)
			const p4 = fn(); // should reject

			await expect( p4 ).rejects.toThrow( 'Queue is full (2 pending commands)' );
			await Promise.allSettled( [ p1, p2, p3 ] );
		} );
	} );

	describe( 'deduplicateKey', () => {
		it( 'should share the same promise for concurrent calls with the same key', async () => {
			let callCount = 0;
			const fn = sequential(
				async ( key: string ) => {
					callCount++;
					await new Promise( ( r ) => setTimeout( r, 50 ) );
					return `result-${ key }`;
				},
				{ deduplicateKey: ( key ) => key }
			);

			const [ r1, r2, r3 ] = await Promise.all( [ fn( 'a' ), fn( 'a' ), fn( 'a' ) ] );

			expect( callCount ).toBe( 1 );
			expect( r1 ).toBe( 'result-a' );
			expect( r2 ).toBe( 'result-a' );
			expect( r3 ).toBe( 'result-a' );
		} );

		it( 'should execute separately for different keys', async () => {
			let callCount = 0;
			const fn = sequential(
				async ( key: string ) => {
					callCount++;
					await new Promise( ( r ) => setTimeout( r, 10 ) );
					return `result-${ key }`;
				},
				{ concurrent: 3, deduplicateKey: ( key ) => key }
			);

			const [ r1, r2 ] = await Promise.all( [ fn( 'a' ), fn( 'b' ) ] );

			expect( callCount ).toBe( 2 );
			expect( r1 ).toBe( 'result-a' );
			expect( r2 ).toBe( 'result-b' );
		} );

		it( 'should allow fresh execution after previous promise resolves', async () => {
			let callCount = 0;
			const fn = sequential(
				async ( _key: string ) => {
					callCount++;
					await new Promise( ( r ) => setTimeout( r, 10 ) );
					return `result-${ callCount }`;
				},
				{ deduplicateKey: ( key ) => key }
			);

			const r1 = await fn( 'a' );
			const r2 = await fn( 'a' );

			expect( callCount ).toBe( 2 );
			expect( r1 ).toBe( 'result-1' );
			expect( r2 ).toBe( 'result-2' );
		} );

		it( 'should share rejection for deduped calls', async () => {
			let callCount = 0;
			const fn = sequential(
				async () => {
					callCount++;
					await new Promise( ( r ) => setTimeout( r, 10 ) );
					throw new Error( 'test error' );
				},
				{ deduplicateKey: () => 'same-key' }
			);

			const results = await Promise.allSettled( [ fn(), fn(), fn() ] );

			expect( callCount ).toBe( 1 );
			results.forEach( ( result ) => {
				expect( result.status ).toBe( 'rejected' );
				if ( result.status === 'rejected' ) {
					expect( result.reason.message ).toBe( 'test error' );
				}
			} );
		} );

		it( 'should not dedup when key function returns undefined', async () => {
			let callCount = 0;
			const fn = sequential(
				async () => {
					callCount++;
					await new Promise( ( r ) => setTimeout( r, 10 ) );
				},
				{ concurrent: 3, deduplicateKey: () => undefined }
			);

			await Promise.all( [ fn(), fn(), fn() ] );
			expect( callCount ).toBe( 3 );
		} );

		it( 'should dedup calls even when first call is queued waiting for a slot', async () => {
			let callCount = 0;
			const fn = sequential(
				async ( key: string ) => {
					callCount++;
					await new Promise( ( r ) => setTimeout( r, 50 ) );
					return `result-${ key }`;
				},
				{ concurrent: 1, deduplicateKey: ( key ) => key }
			);

			const p1 = fn( 'a' ); // running (takes slot)
			const p2 = fn( 'b' ); // queued (waiting for slot)
			const p3 = fn( 'b' ); // should dedup with p2

			const [ r1, r2, r3 ] = await Promise.all( [ p1, p2, p3 ] );

			expect( callCount ).toBe( 2 ); // only 'a' and 'b', not 'b' twice
			expect( r1 ).toBe( 'result-a' );
			expect( r2 ).toBe( 'result-b' );
			expect( r3 ).toBe( 'result-b' );
		} );

		it( 'should not permanently cache a queue-full rejection for deduped keys', async () => {
			const fn = sequential(
				async ( key: string ) => {
					await new Promise( ( r ) => setTimeout( r, 50 ) );
					return `result-${ key }`;
				},
				{ concurrent: 1, max: 1, deduplicateKey: ( key ) => key }
			);

			const p1 = fn( 'a' ); // running (takes the slot)
			const p2 = fn( 'b' ); // queued (1 — fills the max)
			const p3 = fn( 'c' ); // should reject: queue is full

			await expect( p3 ).rejects.toThrow( 'Queue is full' );

			// Wait for p1 and p2 to finish so the queue is empty
			await Promise.all( [ p1, p2 ] );

			// Now 'c' should work fine — the rejection must not be cached
			const result = await fn( 'c' );
			expect( result ).toBe( 'result-c' );
		} );

		it( 'should not count deduped calls against max queue size', async () => {
			const fn = sequential(
				async ( key: string ) => {
					await new Promise( ( r ) => setTimeout( r, 50 ) );
					return key;
				},
				{ concurrent: 1, max: 2, deduplicateKey: ( key ) => key }
			);

			// First call runs, second and third queue, but 'a' duplicates share a promise
			const p1 = fn( 'a' ); // running
			const p2 = fn( 'a' ); // deduped — shares p1's promise
			const p3 = fn( 'b' ); // queued (1)
			const p4 = fn( 'c' ); // queued (2)
			const p5 = fn( 'a' ); // deduped — shares p1's promise

			const [ r1, r2, r3, r4, r5 ] = await Promise.all( [ p1, p2, p3, p4, p5 ] );

			expect( r1 ).toBe( 'a' );
			expect( r2 ).toBe( 'a' );
			expect( r5 ).toBe( 'a' );
			expect( r3 ).toBe( 'b' );
			expect( r4 ).toBe( 'c' );
		} );
	} );
} );
