import express from 'express';
import type { Request, Response } from 'express';
import { AGENT_CARD_PATH } from '@a2a-js/sdk';
import { DefaultRequestHandler, InMemoryTaskStore } from '@a2a-js/sdk/server';
import { jsonRpcHandler, restHandler, UserBuilder } from '@a2a-js/sdk/server/express';
import { buildAgentCard, getPort } from './agent-card.js';
import { StudioCodeExecutor } from './executor.js';

const port = getPort();
const agentCard = buildAgentCard( port );
const taskStore = new InMemoryTaskStore();
const executor = new StudioCodeExecutor();
const handler = new DefaultRequestHandler( agentCard, taskStore, executor );

const userBuilder = UserBuilder.noAuthentication;

const app = express();
// Do NOT add express.json() globally — the A2A SDK handlers parse request bodies themselves.
// Adding it would consume the stream before the handlers can read it.

// Agent Card discovery
// Express 5 doesn't match dot-prefixed segments (`.well-known`) with app.get(),
// so we use a manual middleware that checks req.path.
app.use( ( req: Request, res: Response, next ) => {
	if ( req.method === 'GET' && req.path === `/${ AGENT_CARD_PATH }` ) {
		res.json( agentCard );
		return;
	}
	next();
} );

// Health check
app.get( '/health', ( _req: Request, res: Response ) => {
	res.json( { status: 'ok', agent: agentCard.name, version: agentCard.version } );
} );

// A2A JSON-RPC at /jsonrpc (standard) and / (for clients that POST to root)
app.post( '/jsonrpc', jsonRpcHandler( { requestHandler: handler, userBuilder } ) );
app.post( '/', jsonRpcHandler( { requestHandler: handler, userBuilder } ) );

// A2A REST endpoints at root — Gemini CLI uses {agent_url}/message/stream etc.
app.use( '/', restHandler( { requestHandler: handler, userBuilder } ) );

const server = app.listen( port, () => {
	const cardUrl = `http://localhost:${ port }/${ AGENT_CARD_PATH }`;
	console.log( `\nWordPress Studio Code A2A Server` );
	console.log( `================================` );
	console.log( `Agent Card: ${ cardUrl }` );
	console.log( `Health:     http://localhost:${ port }/health` );
	console.log( '' );
	console.log( `To connect from Gemini CLI, create ~/.gemini/agents/studio-code.md:` );
	console.log( '' );
	console.log( `  ---` );
	console.log( `  kind: remote` );
	console.log( `  name: studio-code` );
	console.log( `  agent_card_url: ${ cardUrl }` );
	console.log( `  ---` );
	console.log( '' );
} );

process.on( 'SIGINT', () => {
	console.log( '\nShutting down...' );
	server.close( () => process.exit( 0 ) );
} );
process.on( 'SIGTERM', () => {
	server.close( () => process.exit( 0 ) );
} );
