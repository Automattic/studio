import { dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as Sentry from '@sentry/electron/main';
import * as forge from 'node-forge';
import sudo from 'sudo-prompt';
import { getUserDataCertificatesPath } from 'src/storage/paths';
import { shellOpenExternalWrapper } from './shell-open-external-wrapper';

// Certificate configuration
const CA_NAME = 'WordPress Studio CA';
const CA_CERT_VALIDITY_DAYS = 3650; // 10 years
const SITE_CERT_VALIDITY_DAYS = 825; // a little over 2 years
const CERT_DIRECTORY = getUserDataCertificatesPath();
const CA_CERT_PATH = path.join( CERT_DIRECTORY, 'studio-ca.crt' );
const CA_KEY_PATH = path.join( CERT_DIRECTORY, 'studio-ca.key' );

// Make sure the certificates directory exists
if ( ! fs.existsSync( path.join( CERT_DIRECTORY, 'domains' ) ) ) {
	fs.mkdirSync( path.join( CERT_DIRECTORY, 'domains' ), { recursive: true } );
}

/**
 * Generate a root CA certificate if it doesn't exist
 */
export async function ensureRootCA(): Promise< { cert: string; key: string } > {
	// Check if CA cert and key already exist
	if ( fs.existsSync( CA_CERT_PATH ) && fs.existsSync( CA_KEY_PATH ) ) {
		return {
			cert: fs.readFileSync( CA_CERT_PATH, 'utf8' ),
			key: fs.readFileSync( CA_KEY_PATH, 'utf8' ),
		};
	}

	// Generate a new CA certificate
	console.log( 'Generating new root CA certificate...' );

	// Generate a key pair
	const keys = forge.pki.rsa.generateKeyPair( 2048 );

	// Create a certificate
	const cert = forge.pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = '01';
	cert.validity.notBefore = new Date();
	cert.validity.notAfter = new Date();
	cert.validity.notAfter.setDate( cert.validity.notBefore.getDate() + CA_CERT_VALIDITY_DAYS );

	// Set certificate attributes
	const attrs = [
		{ name: 'commonName', value: CA_NAME },
		{ name: 'countryName', value: 'US' },
		{ name: 'organizationName', value: 'WordPress Studio' },
		{ name: 'organizationalUnitName', value: 'Development' },
	];
	cert.setSubject( attrs );
	cert.setIssuer( attrs );

	// Set extensions
	cert.setExtensions( [
		{
			name: 'basicConstraints',
			cA: true,
		},
		{
			name: 'keyUsage',
			keyCertSign: true,
			digitalSignature: true,
			nonRepudiation: true,
			keyEncipherment: true,
			dataEncipherment: true,
		},
		{
			name: 'extKeyUsage',
			serverAuth: true,
			clientAuth: true,
		},
		{
			name: 'nsCertType',
			client: true,
			server: true,
			email: true,
			objsign: true,
			sslCA: true,
			emailCA: true,
			objCA: true,
		},
	] );

	// Self-sign the certificate
	cert.sign( keys.privateKey, forge.md.sha256.create() );

	// Convert to PEM format
	const certPem = forge.pki.certificateToPem( cert );
	const keyPem = forge.pki.privateKeyToPem( keys.privateKey );

	// Save to files
	fs.writeFileSync( CA_CERT_PATH, certPem );
	fs.writeFileSync( CA_KEY_PATH, keyPem );

	// Trust the CA certificate
	await trustRootCA();

	return { cert: certPem, key: keyPem };
}

export async function openCertificate() {
	shellOpenExternalWrapper( `file://${ CA_CERT_PATH }` );
}

/**
 * Trust the root CA certificate in the system trust store
 */
async function trustRootCA( showResult = false ): Promise< void > {
	try {
		const platform = process.platform;

		if ( platform === 'darwin' ) {
			// macOS - Use sudo to add to system keychain
			await new Promise< void >( ( resolve, reject ) => {
				sudo.exec(
					`security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${ CA_CERT_PATH }"`,
					{ name: 'WordPress Studio' },
					( error ) => {
						if ( error ) {
							console.error( 'Error adding certificate to system trust store:', error );
							if ( showResult ) {
								dialog.showMessageBox( {
									type: 'error',
									title: 'Certificate Trust Failed',
									message: 'Failed to install certificate automatically.',
									detail:
										'Try the manual installation process or restart the application with administrator privileges.',
									buttons: [ 'OK' ],
								} );
							}
							reject( error );
						} else {
							console.log( 'Root CA trusted in macOS keychain' );
							if ( showResult ) {
								dialog.showMessageBox( {
									type: 'info',
									title: 'Certificate Installed',
									message: 'Root certificate has been installed successfully.',
									detail: 'Please restart your browsers for the changes to take effect.',
									buttons: [ 'OK' ],
								} );
							}
							resolve();
						}
					}
				);
			} );
		} else if ( platform === 'win32' ) {
			// Windows - Use certutil
			await new Promise< void >( ( resolve, reject ) => {
				sudo.exec(
					`certutil -addstore -f "ROOT" "${ CA_CERT_PATH }"`,
					{ name: 'WordPress Studio' },
					( error ) => {
						if ( error ) {
							console.error( 'Error adding certificate to system trust store:', error );
							if ( showResult ) {
								dialog.showMessageBox( {
									type: 'error',
									title: 'Certificate Trust Failed',
									message: 'Failed to install certificate automatically.',
									detail:
										'Try the manual installation process or restart the application with administrator privileges.',
									buttons: [ 'OK' ],
								} );
							}
							reject( error );
						} else {
							console.log( 'Root CA trusted in Windows certificate store' );
							if ( showResult ) {
								dialog.showMessageBox( {
									type: 'info',
									title: 'Certificate Installed',
									message: 'Root certificate has been installed successfully.',
									detail: 'Please restart your browsers for the changes to take effect.',
									buttons: [ 'OK' ],
								} );
							}
							resolve();
						}
					}
				);
			} );
		} else if ( platform === 'linux' ) {
			// Linux - Different approaches based on distribution
			// This is a simplified approach that works on many systems
			const copyCmd = `cp "${ CA_CERT_PATH }" /usr/local/share/ca-certificates/studio-ca.crt`;
			const updateCmd = 'update-ca-certificates';

			await new Promise< void >( ( resolve, reject ) => {
				sudo.exec( `${ copyCmd } && ${ updateCmd }`, { name: 'WordPress Studio' }, ( error ) => {
					if ( error ) {
						console.error( 'Error adding certificate to system trust store:', error );
						if ( showResult ) {
							dialog.showMessageBox( {
								type: 'error',
								title: 'Certificate Trust Failed',
								message: 'Failed to install certificate automatically.',
								detail:
									'Try the manual installation process or restart the application with administrator privileges.',
								buttons: [ 'OK' ],
							} );
						}
						reject( error );
					} else {
						console.log( 'Root CA trusted in Linux certificate store' );
						if ( showResult ) {
							dialog.showMessageBox( {
								type: 'info',
								title: 'Certificate Installed',
								message: 'Root certificate has been installed successfully.',
								detail: 'Please restart your browsers for the changes to take effect.',
								buttons: [ 'OK' ],
							} );
						}
						resolve();
					}
				} );
			} );
		} else {
			console.error( 'Unsupported platform for certificate trust:', platform );
			if ( showResult ) {
				dialog.showMessageBox( {
					type: 'error',
					title: 'Unsupported Platform',
					message: `Certificate installation not supported on ${ platform }`,
					detail: 'You may need to manually trust the certificate in your browser.',
					buttons: [ 'OK' ],
				} );
			}
		}
	} catch ( error ) {
		Sentry.captureException( error );
		console.error( 'Failed to trust root CA:', error );
	}
}

/**
 * Generate a certificate for a site domain signed by our CA
 */
export async function generateSiteCertificate(
	domain: string
): Promise< { cert: string; key: string } > {
	try {
		console.log( path.join( CERT_DIRECTORY, 'domains', `${ domain }.crt` ) );
		const siteCertPath = path.join( CERT_DIRECTORY, 'domains', `${ domain }.crt` );
		const siteKeyPath = path.join( CERT_DIRECTORY, 'domains', `${ domain }.key` );

		// Check if site cert and key already exist
		if ( fs.existsSync( siteCertPath ) && fs.existsSync( siteKeyPath ) ) {
			return {
				cert: fs.readFileSync( siteCertPath, 'utf8' ),
				key: fs.readFileSync( siteKeyPath, 'utf8' ),
			};
		}

		// Ensure we have a root CA
		const { cert: caCert, key: caKey } = await ensureRootCA();
		const caPrivateKey = forge.pki.privateKeyFromPem( caKey );
		const caCertObj = forge.pki.certificateFromPem( caCert );

		// Generate a key pair for the site
		const keys = forge.pki.rsa.generateKeyPair( 2048 );

		// Create a certificate
		const cert = forge.pki.createCertificate();
		cert.publicKey = keys.publicKey;
		cert.serialNumber = Date.now().toString();
		cert.validity.notBefore = new Date();
		cert.validity.notAfter = new Date();
		cert.validity.notAfter.setDate( cert.validity.notBefore.getDate() + SITE_CERT_VALIDITY_DAYS );

		// Set certificate attributes
		const attrs = [
			{ name: 'commonName', value: domain },
			{ name: 'countryName', value: 'US' },
			{ name: 'organizationName', value: 'WordPress Studio' },
			{ name: 'organizationalUnitName', value: 'Development Sites' },
		];
		cert.setSubject( attrs );
		cert.setIssuer( caCertObj.subject.attributes );

		// Set extensions with SAN (Subject Alternative Name)
		cert.setExtensions( [
			{
				name: 'basicConstraints',
				cA: false,
			},
			{
				name: 'keyUsage',
				digitalSignature: true,
				keyEncipherment: true,
				dataEncipherment: true,
			},
			{
				name: 'extKeyUsage',
				serverAuth: true,
			},
			{
				name: 'subjectAltName',
				altNames: [
					{
						type: 2, // DNS
						value: domain,
					},
				],
			},
		] );

		// Sign with the CA's private key
		cert.sign( caPrivateKey, forge.md.sha256.create() );

		// Convert to PEM format
		const certPem = forge.pki.certificateToPem( cert );
		const keyPem = forge.pki.privateKeyToPem( keys.privateKey );

		// Save to files
		fs.writeFileSync( siteCertPath, certPem );
		fs.writeFileSync( siteKeyPath, keyPem );

		return { cert: certPem, key: keyPem };
	} catch ( error ) {
		Sentry.captureException( error );
		console.error( `Failed to generate certificate for ${ domain }:`, error );
		throw error;
	}
}
