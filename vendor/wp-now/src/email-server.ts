import express, { Application } from 'express';
import nodemailer, { Transporter } from 'nodemailer';
import { DEFAULT_EMAIL_SERVER_ROUTE } from './constants';

export interface EmailSettings {
	user: string;
	pass: string;
	smtp?: { host: string; port: number; secure: boolean };
	imap?: { host: string; port: number; secure: boolean };
	pop3?: { host: string; port: number; secure: boolean };
	web?: string;
}

export class EmailServer {
	public settings?: EmailSettings | null = null;
	initialized: boolean;

	constructor() {
		this.initialized = false;
	}

	async initialize() {
		if ( this.initialized ) {
			return;
		}
		if ( ! this.settings ) {
			this.settings = await this.getEmailSettings();
			console.log( '>>>>>>>>>>>>>>>>>> EmailServer initialized' );
		}
		this.initialized = true;
		return this;
	}

	async getEmailSettings(): Promise< EmailSettings > {
		try {
			if ( this.settings?.user && this.settings?.pass ) {
				return this.settings;
			}
			this.settings = await nodemailer.createTestAccount();

			return this.settings;
		} catch ( error ) {
			console.error( 'Failed to create test account:', error );
			throw error;
		}
	}

	static createTransporter( settings: EmailSettings ): Transporter {
		console.log( 'Creating transporter with settings', settings );
		return nodemailer.createTransport( {
			host: settings.smtp.host,
			port: settings.smtp.port,
			secure: settings.smtp.secure,
			auth: {
				user: settings.user,
				pass: settings.pass,
			},
		} );
	}

	static async registerRoutes(
		app: Application,
		settings: EmailSettings,
		route: string = DEFAULT_EMAIL_SERVER_ROUTE
	): Promise< void > {
		try {
			if ( ! app ) {
				throw new Error( 'App is not initialized' );
			}

			// @TODO: we can use this as a default until config is added.
			// @TODO: when we make the siteDetails.emailSetting editable, this can be anything, e.g.,
			// const transporter = nodemailer.createTransport( {
			//  service: 'gmail', // Or your SMTP provider
			//  auth: {
			//      user: '', // Your email address.
			//      pass: '', // Your App Password if using Gmail.
			//  },
			// } );

			const transporter = EmailServer.createTransporter( settings );

			app.post( `/${ route }`, express.json(), async ( req, res ) => {
				try {
					const { to, subject, message, headers } = req.body;
					if ( ! transporter ) {
						throw new Error( 'Transporter not initialized' );
					}
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
								res.status( 500 ).send( 'Failed to send email' );
								return;
							}
							console.log( 'Message sent: %s', info?.messageId );
							console.log( 'Preview URL: %s', nodemailer.getTestMessageUrl( info ) );
							res.send(
								'Email sent with the following details: ' +
									JSON.stringify( { to, subject, message, headers } )
							);
						}
					);
				} catch ( error ) {
					console.error( 'Error in email route handler:', error );
					res.status( 500 ).send( 'Internal server error' );
				}
			} );
		} catch ( error ) {
			console.error( 'Error registering email routes:', error );
			throw error;
		}
	}
}

