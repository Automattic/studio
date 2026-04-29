import { Spinner } from 'picospinner';

/**
 * picospinner renders to stdout with no option to change the stream. Several CLI
 * commands emit machine-readable JSON on stdout (e.g. `site list --format=json`),
 * so mixing spinner frames into stdout breaks consumers like `| jq`.
 *
 * Wrap Spinner methods that render output so any `process.stdout.write` calls
 * they make are rerouted to stderr for the duration of the call. This avoids
 * duplicating picospinner internals or patching the private renderer.
 */

function redirectPicospinnerToStderr(): void {
	const withStdoutAsStderr = < T >( fn: () => T ): T => {
		const originalWrite = process.stdout.write.bind( process.stdout );
		process.stdout.write = process.stderr.write.bind(
			process.stderr
		) as typeof process.stdout.write;
		try {
			return fn();
		} finally {
			process.stdout.write = originalWrite;
		}
	};

	const originalRefresh = Spinner.prototype.refresh;
	const originalSetDisplay = Spinner.prototype.setDisplay;
	const originalStart = Spinner.prototype.start;
	const originalStop = Spinner.prototype.stop;

	Spinner.prototype.refresh = function (
		this: Spinner,
		...args: Parameters< Spinner[ 'refresh' ] >
	) {
		return withStdoutAsStderr( () => originalRefresh.apply( this, args ) );
	};
	Spinner.prototype.setDisplay = function (
		this: Spinner,
		...args: Parameters< Spinner[ 'setDisplay' ] >
	) {
		return withStdoutAsStderr( () => originalSetDisplay.apply( this, args ) );
	};
	Spinner.prototype.start = function ( this: Spinner, ...args: Parameters< Spinner[ 'start' ] > ) {
		return withStdoutAsStderr( () => originalStart.apply( this, args ) );
	};
	Spinner.prototype.stop = function ( this: Spinner, ...args: Parameters< Spinner[ 'stop' ] > ) {
		return withStdoutAsStderr( () => originalStop.apply( this, args ) );
	};
}

redirectPicospinnerToStderr();
