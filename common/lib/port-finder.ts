import http from 'http';
import net from 'net';
import { kill as killPort } from 'cross-port-killer';

const DEFAULT_PORT = 8881;

class PortFinder {
	static #instance: PortFinder;
	#searchPort = DEFAULT_PORT;
	#openPort: number | null = null;
	#unavailablePorts: Array< number > = [];

	private constructor() {
		// empty so it can be set private
	}

	public static getInstance(): PortFinder {
		if ( ! PortFinder.#instance ) {
			PortFinder.#instance = new PortFinder();
		}
		return PortFinder.#instance;
	}

	#incrementPort(): number {
		return ++this.#searchPort;
	}

	#isPortFree( portToCheck: number ): Promise< boolean > {
		return new Promise( ( resolve ) => {
			// First try to connect to the port
			const socket = new net.Socket();
			socket.on( 'error', () => {
				// If we can't connect, try to bind to the port
				const server = http.createServer();
				server
					.listen( portToCheck, () => {
						server.close();
						setTimeout( () => {
							resolve( true );
						}, 50 ); // Add a small delay to ensure port is released
					} )
					.on( 'error', () => {
						resolve( false );
					} );
			} );

			// Try to connect to the port
			socket.connect( portToCheck, 'localhost', () => {
				socket.destroy();
				resolve( false );
			} );
		} );
	}

	/**
	 * Returns the first available open port, caching and reusing it for subsequent calls.
	 *
	 * @returns {Promise<number>} A promise that resolves to the open port number.
	 */
	public async getOpenPort( portToStart?: number ): Promise< number > {
		this.#searchPort = portToStart ? portToStart : this.#openPort ?? DEFAULT_PORT;

		if ( portToStart && ( await this.#isPortFree( this.#searchPort ) ) ) {
			const port = this.#searchPort;
			this.#openPort = this.#incrementPort();
			return port;
		}
		let isPortUnavailable = this.#unavailablePorts?.includes( this.#searchPort );

		while ( isPortUnavailable || ! ( await this.#isPortFree( this.#searchPort ) ) ) {
			this.#incrementPort();
			isPortUnavailable = this.#unavailablePorts?.includes( this.#searchPort );
		}

		const port = this.#searchPort;
		this.addUnavailablePort( port );
		this.#openPort = this.#incrementPort();
		return port;
	}

	public setPort( port: number ): void {
		this.#openPort = port;
	}

	public addUnavailablePort( port?: number ): void {
		if ( port && ! this.#unavailablePorts.includes( port ) ) {
			this.#unavailablePorts.push( port );
		}
	}

	public releasePort( port?: number ): void {
		if ( port && this.#unavailablePorts.includes( port ) ) {
			killPort( port )
				.then( () => {
					console.log( `Killed processes using port ${ port }` );
				} )
				.catch( ( err ) => {
					console.error( `Failed to kill processes using port ${ port }: ${ err.message }` );
				} )
				.finally( () => {
					// Ensure port finder cycles through newly reclaimed ports by removing
					// from #unavailablePorts list and resetting #openPort.
					this.#unavailablePorts = this.#unavailablePorts.filter(
						( unavailablePort ) => unavailablePort !== port
					);
					this.#openPort = DEFAULT_PORT;
				} );
		}
	}

	/**
	 * Checks if a specific port is available.
	 *
	 * @param {number} portToCheck - The port number to check.
	 * @returns {Promise<boolean>} A promise that resolves to true if the port is available, false otherwise.
	 **/
	public async isPortAvailable( portToCheck: number ): Promise< boolean > {
		return await this.#isPortFree( portToCheck );
	}
}

export const portFinder = PortFinder.getInstance();
