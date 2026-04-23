import { renderer } from 'picospinner';

/**
 * picospinner renders to stdout with no option to change the stream. Several CLI
 * commands emit machine-readable JSON on stdout (e.g. `site list --format=json`),
 * so mixing spinner frames into stdout breaks consumers like `| jq`.
 *
 * Wrap the renderer's two write-emitting methods so any `process.stdout.write`
 * calls they make are rerouted to stderr for the duration of the call. This
 * avoids duplicating picospinner internals and survives upstream changes as
 * long as `render` and `onComponentFinish` remain the only write paths.
 */
type PatchableRenderer = {
	render: () => void;
	onComponentFinish: () => void;
};

function redirectPicospinnerToStderr(): void {
	const r = renderer as Partial< PatchableRenderer > | undefined;
	if ( ! r || typeof r.render !== 'function' || typeof r.onComponentFinish !== 'function' ) {
		return;
	}

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

	const originalRender = r.render.bind( r );
	const originalOnComponentFinish = r.onComponentFinish.bind( r );

	r.render = () => withStdoutAsStderr( originalRender );
	r.onComponentFinish = () => withStdoutAsStderr( originalOnComponentFinish );
}

redirectPicospinnerToStderr();
