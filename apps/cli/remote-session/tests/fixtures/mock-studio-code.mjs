// Minimal NDJSON emitter used by turn-runner.test.ts to simulate `studio code --json`.
// Mirrors the post-pi-migration wire format: `'message'` envelopes wrap
// `AgentSessionEvent` payloads, with `agent_end` carrying the final
// transcript. `turn.completed` is still emitted separately by JsonAdapter.
//
// SCENARIO env var picks the script:
//   success        — agent_end with success reply text + turn.completed success
//   paused         — question.asked + turn.completed paused
//   error          — agent_end with stopReason='error' + turn.completed error
//   stale-resume   — stale-session stderr line + non-zero exit
//   hang           — never exits (tests timeout path)
//   media-share    — media.share + agent_end with success + turn.completed success

const scenario = process.env.SCENARIO ?? 'success';
const sessionId = process.env.SESSION_ID ?? 'sess-new';
const ts = () => new Date().toISOString();
const emit = ( event ) => process.stdout.write( JSON.stringify( event ) + '\n' );

function assistant( text, { stopReason = 'stop', errorMessage } = {} ) {
	const msg = {
		role: 'assistant',
		content: text ? [ { type: 'text', text } ] : [],
		api: 'anthropic-messages',
		provider: 'anthropic',
		model: 'mock',
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: 0,
	};
	if ( errorMessage ) msg.errorMessage = errorMessage;
	return msg;
}

function emitAgentEnd( messages ) {
	emit( { type: 'message', timestamp: ts(), message: { type: 'agent_end', messages } } );
}

function runSuccess() {
	emit( { type: 'turn.started', timestamp: ts() } );
	emitAgentEnd( [ assistant( 'All done!' ) ] );
	emit( { type: 'turn.completed', timestamp: ts(), sessionId, status: 'success' } );
	process.exit( 0 );
}

function runPaused() {
	emit( { type: 'turn.started', timestamp: ts() } );
	emit( {
		type: 'question.asked',
		timestamp: ts(),
		questions: [
			{
				question: 'Pick one',
				options: [
					{ label: 'A', description: 'first' },
					{ label: 'B', description: 'second' },
				],
			},
		],
	} );
	emit( { type: 'turn.completed', timestamp: ts(), sessionId, status: 'paused' } );
	process.exit( 0 );
}

function runError() {
	emit( { type: 'turn.started', timestamp: ts() } );
	emitAgentEnd( [ assistant( '', { stopReason: 'error', errorMessage: 'boom' } ) ] );
	emit( { type: 'turn.completed', timestamp: ts(), sessionId, status: 'error' } );
	process.exit( 1 );
}

function runStaleResume() {
	process.stderr.write( 'Error: No AI session found for resume ID: bogus-sess-id\n' );
	process.exit( 1 );
}

function runHang() {
	setInterval( () => {}, 1000 );
}

function runMediaShare() {
	emit( { type: 'turn.started', timestamp: ts() } );
	emit( {
		type: 'media.share',
		timestamp: ts(),
		mediaType: 'image',
		mimeType: 'image/png',
		dataBase64: 'AAAA',
		caption: 'Site preview',
	} );
	emit( {
		type: 'media.share',
		timestamp: ts(),
		mediaType: 'image',
		mimeType: 'image/png',
		dataBase64: 'BBBB',
	} );
	emitAgentEnd( [ assistant( 'Want me to publish this as a preview site?' ) ] );
	emit( { type: 'turn.completed', timestamp: ts(), sessionId, status: 'success' } );
	process.exit( 0 );
}

const handlers = {
	success: runSuccess,
	paused: runPaused,
	error: runError,
	'stale-resume': runStaleResume,
	hang: runHang,
	'media-share': runMediaShare,
};

const handler = handlers[ scenario ];
if ( handler ) {
	handler();
} else {
	process.stderr.write( `unknown scenario: ${ scenario }\n` );
	process.exit( 2 );
}
