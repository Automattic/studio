import fs from 'fs';
import { WPNowOptions } from './config';
import { HTTPMethod } from '@php-wasm/universal';
import express from 'express';
import compression from 'compression';
import compressible from 'compressible';
import { portFinder } from './port-finder';
import { PHP } from '@php-wasm/universal';
import startWPNow from './wp-now';
import { output } from './output';
import { addTrailingSlash } from './add-trailing-slash';

const requestBodyToBytes = async ( req ): Promise< Uint8Array > =>
	await new Promise( ( resolve ) => {
		const body = [];
		req.on( 'data', ( chunk ) => {
			body.push( chunk );
		} );
		req.on( 'end', () => {
			resolve( Buffer.concat( body ) );
		} );
	} );

export interface WPNowServer {
	url: string;
	php: PHP;
	options: WPNowOptions;
	stopServer: () => Promise<void>;
}

function shouldCompress(_, res) {
	const types = res.getHeader('content-type');
	const type = Array.isArray(types) ? types[0] : types;
	return type && compressible(type);
}

export async function startServer(
	options: WPNowOptions = {}
): Promise<WPNowServer> {
	if (!fs.existsSync(options.projectPath)) {
		throw new Error(
			`The given path "${options.projectPath}" does not exist.`
		);
	}

	const app = express();
	app.use(compression({ filter: shouldCompress }));
	app.use(addTrailingSlash('/wp-admin'));
	const port = options.port ?? await portFinder.getOpenPort();
	const { php, options: wpNowOptions, requestHandler } = await startWPNow(options);
	app.use('/', async (req, res) => {
		try {
			const requestHeaders = {};
			if (req.rawHeaders && req.rawHeaders.length) {
				for (let i = 0; i < req.rawHeaders.length; i += 2) {
					requestHeaders[req.rawHeaders[i].toLowerCase()] =
						req.rawHeaders[i + 1];
				}
			}

			const data = {
				url: req.url,
				headers: requestHeaders,
				method: req.method as HTTPMethod,
				body: await requestBodyToBytes( req ),
			};
			const resp = await requestHandler.request(data);
			res.statusCode = resp.httpStatusCode;
			Object.keys(resp.headers).forEach((key) => {
				res.setHeader(key, resp.headers[key]);
			});
			res.end(resp.bytes);
		} catch (e) {
			output?.trace(e);
		}
	});
	const url = options.absoluteUrl;
	const server = app.listen(port, () => {
		output?.log(`Server running at ${url}`);
	});

	return {
		url,
		php,
		options: wpNowOptions,
		stopServer: () =>
			new Promise((res) => {
				server.close(() => {
					output?.log(`Server stopped`);
					res();
				});
			}),
	};
}
