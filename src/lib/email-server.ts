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

		const testAccount = await nodemailer.createTestAccount();

		// const transporter = nodemailer.createTransport( {
		// 	service: 'gmail', // Or your SMTP provider
		// 	auth: {
		// 		user: '', // Your email address.
		// 		pass: '', // Your App Password if using Gmail.
		// 	},
		// } );

		// @TODO: we can use this as a default until config is added.
		// We have to show the testAccount details to the user.
		// The login to https://ethereal.email/messages with the details to get all caught emails.
		console.log( 'Email server testAccount', testAccount );
		const transporter = nodemailer.createTransport( {
			host: 'smtp.ethereal.email',
			port: 587,
			secure: false,
			auth: {
				user: testAccount.user,
				pass: testAccount.pass,
			},
		} );

		//this.port = await portFinder.getOpenPort();
		this.port = await portFinder.getOpenPort( 7777 );

		// Add a basic route handler
		app.post( '/email', ( req, res ) => {
			const { to, subject, message, headers } = req.body;
			transporter.sendMail(
				{
					from: 'WordPress <studio-test@wordpress.com>',
					to,
					subject,
					html: `<div>${ message }</div>`,
				},
				( err, info ) => {
					if ( err ) {
						console.error( 'Email failed:', err );
					}
					console.log( 'Message sent: %s', info?.messageId );
					console.log( 'Preview URL: %s', nodemailer.getTestMessageUrl( info ) );
				}
			);
			res.send(
				'Email sent with the following details: ' +
					JSON.stringify( { to, subject, message, headers } )
			);
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
