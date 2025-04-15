import { Server } from 'http';
import express from 'express';
import nodemailer from 'nodemailer';
import { portFinder } from './port-finder';

class EmailServer {
	private server: Server | null = null;
	private port: number | null = null;

	async start(): Promise< number > {
		if ( this.server ) {
			return this.port!;
		}

		const app = express();
		app.use( express.json() );

		// @TODO: service should be configurable via Studio settings.
		// @TODO: check if we can use WPCOM endpoint for sending emails.
		const transporter = nodemailer.createTransport( {
			service: 'gmail', // Or your SMTP provider
			auth: {
				user: '', // Your email address.
				pass: '', // Your App Password if using Gmail.
			},
		} );

		//this.port = await portFinder.getOpenPort();
		this.port = await portFinder.getOpenPort( 7777 );

		// Add a basic route handler
		app.post( '/email', ( req, res ) => {
			const { to, subject, message, headers } = req.body;
			transporter.sendMail(
				{
					from: 'WordPress <[email protected]>',
					to,
					subject,
					html: message,
					headers,
				},
				( err ) => {
					if ( err ) console.error( 'Email failed:', err );
				}
			);
			res.send( 'SMTP Server is running on port ' + this.port );
		} );

		// Start server
		await new Promise< void >( ( resolve ) => {
			this.server = app.listen( this.port, () => resolve() );
		} );

		return this.port;
	}

	async stop(): Promise< void > {
		if ( this.server ) {
			await new Promise< void >( ( resolve ) => {
				this.server!.close( () => resolve() );
			} );
			this.server = null;
		}
		if ( this.port ) {
			portFinder.releasePort( this.port );
			this.port = null;
		}
	}
}

export const emailServer = new EmailServer();
