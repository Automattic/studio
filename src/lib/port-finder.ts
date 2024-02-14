import http from 'http';

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

	#isPortFree(): Promise< boolean > {
		return new Promise( ( resolve ) => {
			const server = http.createServer();

			server
				.listen( this.#searchPort, () => {
					server.close();
					resolve( true );
				} )
				.on( 'error', () => {
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
		if ( portToStart && ( await this.#isPortFree() ) ) {
			const port = this.#searchPort;
			this.#openPort = this.#incrementPort();
			return port;
		}
		let isPortUnavailable = this.#unavailablePorts?.includes( this.#searchPort );

		while ( isPortUnavailable || ! ( await this.#isPortFree() ) ) {
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
}

export const portFinder = PortFinder.getInstance();
