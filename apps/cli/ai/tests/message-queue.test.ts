import { describe, expect, it } from 'vitest';
import { MessageQueue } from 'cli/ai/message-queue';

describe( 'MessageQueue', () => {
	it( 'dequeue resolves immediately when queue has items', async () => {
		const queue = new MessageQueue();
		queue.enqueue( 'hello' );
		const message = await queue.dequeue();
		expect( message ).toBe( 'hello' );
	} );

	it( 'dequeue parks until enqueue is called', async () => {
		const queue = new MessageQueue();
		const promise = queue.dequeue();
		queue.enqueue( 'delayed' );
		const message = await promise;
		expect( message ).toBe( 'delayed' );
	} );

	it( 'processes messages in FIFO order', async () => {
		const queue = new MessageQueue();
		queue.enqueue( 'first' );
		queue.enqueue( 'second' );
		queue.enqueue( 'third' );
		expect( await queue.dequeue() ).toBe( 'first' );
		expect( await queue.dequeue() ).toBe( 'second' );
		expect( await queue.dequeue() ).toBe( 'third' );
	} );

	it( 'pending returns all queued messages', () => {
		const queue = new MessageQueue();
		queue.enqueue( 'a' );
		queue.enqueue( 'b' );
		expect( queue.pending() ).toEqual( [ 'a', 'b' ] );
	} );

	it( 'pending returns empty array when queue is empty', () => {
		const queue = new MessageQueue();
		expect( queue.pending() ).toEqual( [] );
	} );

	it( 'remove deletes message at index', async () => {
		const queue = new MessageQueue();
		queue.enqueue( 'a' );
		queue.enqueue( 'b' );
		queue.enqueue( 'c' );
		queue.remove( 1 );
		expect( queue.pending() ).toEqual( [ 'a', 'c' ] );
		expect( await queue.dequeue() ).toBe( 'a' );
		expect( await queue.dequeue() ).toBe( 'c' );
	} );

	it( 'remove with out-of-bounds index is a no-op', () => {
		const queue = new MessageQueue();
		queue.enqueue( 'a' );
		queue.remove( 5 );
		expect( queue.pending() ).toEqual( [ 'a' ] );
	} );

	it( 'replace updates message at index', () => {
		const queue = new MessageQueue();
		queue.enqueue( 'original' );
		queue.enqueue( 'keep' );
		queue.replace( 0, 'edited' );
		expect( queue.pending() ).toEqual( [ 'edited', 'keep' ] );
	} );

	it( 'replace with out-of-bounds index is a no-op', () => {
		const queue = new MessageQueue();
		queue.enqueue( 'a' );
		queue.replace( 5, 'nope' );
		expect( queue.pending() ).toEqual( [ 'a' ] );
	} );

	it( 'length reflects current queue size', () => {
		const queue = new MessageQueue();
		expect( queue.length ).toBe( 0 );
		queue.enqueue( 'a' );
		expect( queue.length ).toBe( 1 );
		queue.enqueue( 'b' );
		expect( queue.length ).toBe( 2 );
	} );

	it( 'dequeue reduces length', async () => {
		const queue = new MessageQueue();
		queue.enqueue( 'a' );
		queue.enqueue( 'b' );
		await queue.dequeue();
		expect( queue.length ).toBe( 1 );
	} );

	it( 'onChange callback fires on enqueue, remove, and replace', () => {
		const calls: string[][] = [];
		const queue = new MessageQueue();
		queue.onChange = () => calls.push( [ ...queue.pending() ] );
		queue.enqueue( 'a' );
		queue.enqueue( 'b' );
		queue.remove( 0 );
		queue.replace( 0, 'edited' );
		expect( calls ).toEqual( [ [ 'a' ], [ 'a', 'b' ], [ 'b' ], [ 'edited' ] ] );
	} );
} );
