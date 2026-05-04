// Minimal NDJSON emitter used by turn-runner.test.ts to simulate `studio code --json`.
// The SCENARIO env var selects which script to play:
//   success        — emits a result with reply text + turn.completed success
//   paused         — emits a question.asked + turn.completed paused
//   error          — emits a result with is_error + turn.completed error
//   stale-resume   — writes a stale-session-looking line to stderr + exits non-zero
//   hang           — never exits (tests timeout path)
//   media-share    — emits a media.share + result + turn.completed success

const scenario = process.env.SCENARIO ?? 'success';
const sessionId = process.env.SESSION_ID ?? 'sess-new';
const ts = () => new Date().toISOString();
const emit = ( event ) => process.stdout.write( JSON.stringify( event ) + '\n' );

function runSuccess() {
	emit( { type: 'turn.started', timestamp: ts() } );
	emit( {
		type: 'message',
		timestamp: ts(),
		message: {
			type: 'result',
			subtype: 'success',
			is_error: false,
			result: 'All done!',
			session_id: sessionId,
			duration_ms: 10,
			duration_api_ms: 5,
			num_turns: 1,
			stop_reason: 'end_turn',
			total_cost_usd: 0,
			usage: {},
			modelUsage: {},
			permission_denials: [],
			uuid: 'u',
		},
	} );
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
	emit( {
		type: 'message',
		timestamp: ts(),
		message: {
			type: 'result',
			subtype: 'error_during_execution',
			is_error: true,
			session_id: sessionId,
			errors: [ 'boom' ],
			duration_ms: 5,
			duration_api_ms: 2,
			num_turns: 1,
			stop_reason: null,
			total_cost_usd: 0,
			usage: {},
			modelUsage: {},
			permission_denials: [],
			uuid: 'u',
		},
	} );
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
	emit( {
		type: 'message',
		timestamp: ts(),
		message: {
			type: 'result',
			subtype: 'success',
			is_error: false,
			result: 'Want me to publish this as a preview site?',
			session_id: sessionId,
			duration_ms: 10,
			duration_api_ms: 5,
			num_turns: 1,
			stop_reason: 'end_turn',
			total_cost_usd: 0,
			usage: {},
			modelUsage: {},
			permission_denials: [],
			uuid: 'u',
		},
	} );
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
