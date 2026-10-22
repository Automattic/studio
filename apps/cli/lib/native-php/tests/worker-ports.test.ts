/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest';
import { getAvailablePorts } from '../worker-ports';

// An OS that hands out the lowest free port, so it reuses a port the moment it is
// released. Real kernels can do the same (Linux picks ephemeral ports at random,
// and other processes take ports in between), which is what this guards against.
const { boundPorts } = vi.hoisted( () => ( { boundPorts: new Set< number >() } ) );

vi.mock( 'node:net', async () => {
	const { EventEmitter } = await import( 'node:events' );

	class FakeServer extends EventEmitter {
		private port: number | undefined;
		listening = false;

		listen( _port: number, _host: string, onListening: () => void ) {
			let port = 50_000;
			while ( boundPorts.has( port ) ) {
				port++;
			}
			boundPorts.add( port );
			this.port = port;
			this.listening = true;
			setImmediate( onListening );
			return this;
		}

		address() {
			return this.port === undefined
				? null
				: { port: this.port, address: '127.0.0.1', family: 'IPv4' };
		}

		close( onClose?: () => void ) {
			if ( this.port !== undefined ) {
				boundPorts.delete( this.port );
			}
			this.listening = false;
			setImmediate( () => onClose?.() );
			return this;
		}

		unref() {
			return this;
		}
	}

	const net = { createServer: () => new FakeServer() };
	return { default: net, ...net };
} );

describe( 'getAvailablePorts', () => {
	it( 'returns distinct ports even when the OS reuses released ports', async () => {
		const ports = await getAvailablePorts( 4 );

		expect( ports ).toHaveLength( 4 );
		expect( new Set( ports ).size ).toBe( 4 );
	} );

	it( 'releases every port before returning, so the workers can bind them', async () => {
		await getAvailablePorts( 4 );

		expect( boundPorts.size ).toBe( 0 );
	} );
} );
