/**
 * @vitest-environment node
 */
import { expect, it, vi } from 'vitest';
import { getAvailablePorts } from '../worker-ports';

// An OS that always hands out the lowest free port, so a released port comes straight back.
// Linux does this at random (about 1 in 1,000 four-port pools on a real kernel).
const { boundPorts } = vi.hoisted( () => ( { boundPorts: new Set< number >() } ) );

vi.mock( 'node:net', () => {
	class FakeServer {
		port = 0;
		once() {}
		unref() {
			return this;
		}
		listen( _port: number, _host: string, onListening: () => void ) {
			for ( this.port = 50_000; boundPorts.has( this.port ); this.port++ );
			boundPorts.add( this.port );
			setImmediate( onListening );
		}
		address() {
			return { port: this.port };
		}
		close( onClose: () => void ) {
			boundPorts.delete( this.port );
			setImmediate( onClose );
		}
	}
	const net = { createServer: () => new FakeServer() };
	return { default: net, ...net };
} );

it( 'returns distinct ports and releases them all for the workers to bind', async () => {
	const ports = await getAvailablePorts( 4 );

	expect( new Set( ports ).size ).toBe( 4 );
	expect( boundPorts.size ).toBe( 0 );
} );
