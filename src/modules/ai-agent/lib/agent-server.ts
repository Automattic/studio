import { Server } from 'http';
import express, { Express, Request, Response } from 'express';
import { portFinder } from 'common/lib/port-finder';
import { processChat, validateApiKey } from './anthropic-client';
import {
	saveApiKey,
	getApiKey,
	hasApiKey,
	removeApiKey,
	validateApiKeyFormat,
} from './api-key-storage';
import type { AgentMessage, AgentStatus, ChatRequest } from '../types';

const BASE_PORT = 9500;

let server: Server | null = null;
let serverPort: number | null = null;

/**
 * Create and configure the Express app.
 */
function createApp(): Express {
	const app = express();

	// Middleware
	app.use( express.json() );

	// CORS middleware for local requests
	app.use( ( req, res, next ) => {
		res.header( 'Access-Control-Allow-Origin', '*' );
		res.header( 'Access-Control-Allow-Methods', 'GET, POST, OPTIONS' );
		res.header( 'Access-Control-Allow-Headers', 'Content-Type' );

		if ( req.method === 'OPTIONS' ) {
			res.sendStatus( 200 );
			return;
		}

		next();
	} );

	// Health check
	app.get( '/health', ( _req: Request, res: Response ) => {
		res.json( { status: 'ok', port: serverPort } );
	} );

	// Status check
	app.get( '/status', async ( _req: Request, res: Response ) => {
		try {
			const isConfigured = await hasApiKey();
			const status: AgentStatus = {
				isConfigured,
				serverPort,
			};
			res.json( status );
		} catch ( error ) {
			res.status( 500 ).json( { error: 'Failed to get status' } );
		}
	} );

	// Configure API key
	app.post( '/configure', async ( req: Request, res: Response ) => {
		try {
			const { apiKey } = req.body;

			if ( ! apiKey || typeof apiKey !== 'string' ) {
				res.status( 400 ).json( { error: 'API key is required' } );
				return;
			}

			// Validate format
			if ( ! validateApiKeyFormat( apiKey ) ) {
				res.status( 400 ).json( {
					error: 'Invalid API key format. Anthropic API keys start with "sk-ant-"',
				} );
				return;
			}

			// Validate the key works
			const isValid = await validateApiKey( apiKey );
			if ( ! isValid ) {
				res.status( 400 ).json( {
					error: 'API key validation failed. Please check your key and try again.',
				} );
				return;
			}

			// Save the key
			await saveApiKey( apiKey );

			res.json( { success: true, message: 'API key configured successfully' } );
		} catch ( error ) {
			const errorMessage = error instanceof Error ? error.message : String( error );
			res.status( 500 ).json( { error: `Failed to configure API key: ${ errorMessage }` } );
		}
	} );

	// Remove API key
	app.delete( '/configure', async ( _req: Request, res: Response ) => {
		try {
			await removeApiKey();
			res.json( { success: true, message: 'API key removed' } );
		} catch ( error ) {
			res.status( 500 ).json( { error: 'Failed to remove API key' } );
		}
	} );

	// Chat endpoint with SSE streaming
	app.post( '/chat', async ( req: Request, res: Response ) => {
		try {
			const { message, siteId } = req.body as ChatRequest;

			if ( ! message || typeof message !== 'string' ) {
				res.status( 400 ).json( { error: 'Message is required' } );
				return;
			}

			if ( ! siteId || typeof siteId !== 'string' ) {
				res.status( 400 ).json( { error: 'Site ID is required' } );
				return;
			}

			// Check if API key is configured
			const apiKey = await getApiKey();
			if ( ! apiKey ) {
				res.status( 401 ).json( {
					error: 'API key not configured',
					code: 'NO_API_KEY',
				} );
				return;
			}

			// Get chat history from request body (optional)
			const history: AgentMessage[] = req.body.history || [];

			// Set up SSE headers
			res.setHeader( 'Content-Type', 'text/event-stream' );
			res.setHeader( 'Cache-Control', 'no-cache' );
			res.setHeader( 'Connection', 'keep-alive' );
			res.flushHeaders();

			// Process the chat with streaming
			await processChat( message, siteId, history, res );
		} catch ( error ) {
			const errorMessage = error instanceof Error ? error.message : String( error );
			console.error( 'Chat error:', error );

			// If headers haven't been sent, send error as JSON
			if ( ! res.headersSent ) {
				res.status( 500 ).json( { error: `Chat failed: ${ errorMessage }` } );
			} else {
				// Otherwise, send as SSE event
				res.write(
					`data: ${ JSON.stringify( { type: 'error', data: { message: errorMessage } } ) }\n\n`
				);
				res.end();
			}
		}
	} );

	return app;
}

/**
 * Start the agent server.
 */
export async function startAgentServer(): Promise< number > {
	if ( server ) {
		console.log( `Agent server already running on port ${ serverPort }` );
		return serverPort!;
	}

	// In dev mode, auto-configure from environment variable if not already set
	if ( process.env.IS_DEV_BUILD || ! require( 'electron' ).app.isPackaged ) {
		const envApiKey = process.env.ANTHROPIC_API_KEY;
		if ( envApiKey && validateApiKeyFormat( envApiKey ) ) {
			const alreadyConfigured = await hasApiKey();
			if ( ! alreadyConfigured ) {
				await saveApiKey( envApiKey );
				console.log( 'Auto-configured Anthropic API key from environment variable' );
			}
		}
	}

	// Find an available port
	const port = await portFinder.getOpenPort( BASE_PORT );

	const app = createApp();

	return new Promise( ( resolve, reject ) => {
		server = app.listen( port, '127.0.0.1', () => {
			serverPort = port;
			console.log( `Agent server started on port ${ port }` );
			resolve( port );
		} );

		server.on( 'error', ( error ) => {
			console.error( 'Failed to start agent server:', error );
			server = null;
			serverPort = null;
			reject( error );
		} );
	} );
}

/**
 * Stop the agent server.
 */
export async function stopAgentServer(): Promise< void > {
	if ( ! server ) {
		return;
	}

	return new Promise( ( resolve, reject ) => {
		server!.close( ( error ) => {
			if ( error ) {
				console.error( 'Error stopping agent server:', error );
				reject( error );
			} else {
				console.log( 'Agent server stopped' );
				server = null;
				serverPort = null;
				resolve();
			}
		} );
	} );
}

/**
 * Get the current server port.
 */
export function getAgentServerPort(): number | null {
	return serverPort;
}

/**
 * Check if the server is running.
 */
export function isAgentServerRunning(): boolean {
	return server !== null;
}
