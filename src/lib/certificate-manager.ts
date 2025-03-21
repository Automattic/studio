import { shell } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Sentry from '@sentry/electron/main';
import sudo from '@vscode/sudo-prompt';
import forge from 'node-forge';
import { getUserDataCertificatesPath } from 'src/storage/paths';

/**
 * Generate name constraints in conformance with
 * [RFC 5280 § 4.2.1.10](https://datatracker.ietf.org/doc/html/rfc5280#section-4.2.1.10),
 * optimized for domain name constraints.
 */
function createNameConstraintsExtension( domains: string[] ) {
	const asn1 = forge.asn1;

	// Convert domains to GeneralSubtree sequences
	const domainsToSequence = ( domains: Array< string > ) =>
		domains.map( ( domain ) => {
			// Create a GeneralName for the domain (dNSName, type 2)
			const generalName = asn1.create( asn1.Class.CONTEXT_SPECIFIC, 2, false, domain );

			// Create a GeneralSubtree containing the GeneralName
			// According to the RFC: GeneralSubtree ::= SEQUENCE {
			//   base GeneralName, minimum [0] BaseDistance DEFAULT 0, maximum [1] BaseDistance OPTIONAL }
			return asn1.create(
				asn1.Class.UNIVERSAL,
				asn1.Type.SEQUENCE,
				true,
				[ generalName ]
				// The minimum value is DEFAULT 0, so we can omit it for simplicity
				// The maximum value is OPTIONAL and we don't need it
			);
		} );

	// Build the NameConstraints structure
	const nameConstraintsComponents: Array< forge.asn1.Asn1 > = [];

	// Add permitted subtrees (tag 0)
	nameConstraintsComponents.push(
		asn1.create( asn1.Class.CONTEXT_SPECIFIC, 0, true, domainsToSequence( domains ) )
	);

	// Create the full NameConstraints structure
	// NameConstraints ::= SEQUENCE { permittedSubtrees [0] GeneralSubtrees OPTIONAL,
	//                                excludedSubtrees [1] GeneralSubtrees OPTIONAL }
	const nameConstraintsValue = asn1.create(
		asn1.Class.UNIVERSAL,
		asn1.Type.SEQUENCE,
		true,
		nameConstraintsComponents
	);

	return {
		id: '2.5.29.30', // nameConstraints OID
		critical: true,
		value: nameConstraintsValue,
	};
}

// Certificate configuration
const CA_NAME = 'WordPress Studio CA';
const CA_CERT_VALIDITY_DAYS = 3650; // 10 years
const SITE_CERT_VALIDITY_DAYS = 825; // a little over 2 years
const CERT_DIRECTORY = getUserDataCertificatesPath();
const CA_CERT_PATH = path.join( CERT_DIRECTORY, 'studio-ca.crt' );
const CA_KEY_PATH = path.join( CERT_DIRECTORY, 'studio-ca.key' );

/**
 * Initialize the certificates directory
 */
function initializeCertificatesDirectory() {
	if ( ! fs.existsSync( path.join( CERT_DIRECTORY, 'domains' ) ) ) {
		fs.mkdirSync( path.join( CERT_DIRECTORY, 'domains' ), { recursive: true } );
	}
}

/**
 * Generate a root CA certificate if it doesn't exist
 */
export async function ensureRootCA(): Promise< { cert: string; key: string } > {
	// If the certificate already exists, no need to generate a new one
	if ( fs.existsSync( CA_CERT_PATH ) && fs.existsSync( CA_KEY_PATH ) ) {
		return {
			cert: fs.readFileSync( CA_CERT_PATH, 'utf8' ),
			key: fs.readFileSync( CA_KEY_PATH, 'utf8' ),
		};
	}

	console.log( 'Generating new root CA certificate...' );

	const keys = forge.pki.rsa.generateKeyPair( 2048 );
	const cert = forge.pki.createCertificate();

	cert.publicKey = keys.publicKey;
	cert.serialNumber = crypto.randomBytes( 20 ).toString( 'hex' );
	const now = new Date();
	cert.validity.notBefore = now;
	cert.validity.notAfter = new Date( now.getTime() );
	cert.validity.notAfter.setDate( now.getDate() + CA_CERT_VALIDITY_DAYS );
	const attrs = [
		{ name: 'commonName', value: CA_NAME },
		{ name: 'countryName', value: 'US' },
		{ name: 'organizationName', value: 'WordPress Studio' },
	];
	cert.setSubject( attrs );
	cert.setIssuer( attrs );

	const extensions = [
		{
			name: 'basicConstraints',
			cA: true,
			critical: true,
			pathLenConstraint: 0, // Can only sign end entity certificates, not intermediate CAs
		},
		{
			name: 'keyUsage',
			critical: true,
			keyCertSign: true,
			cRLSign: true,
		},
		{
			name: 'extKeyUsage',
			serverAuth: true,
			clientAuth: true,
		},
		createNameConstraintsExtension( [ '.local' ] ),
	];
	cert.setExtensions( extensions );

	// Self-sign the certificate
	cert.sign( keys.privateKey, forge.md.sha256.create() );

	const certPem = forge.pki.certificateToPem( cert );
	const keyPem = forge.pki.privateKeyToPem( keys.privateKey );
	initializeCertificatesDirectory();
	fs.writeFileSync( CA_CERT_PATH, certPem );
	fs.writeFileSync( CA_KEY_PATH, keyPem );
	fs.chmodSync( CA_CERT_PATH, 0o700 );
	fs.chmodSync( CA_KEY_PATH, 0o700 );

	await trustRootCA();

	return { cert: certPem, key: keyPem };
}

export async function openCertificate() {
	shell.showItemInFolder( CA_CERT_PATH );
}

/**
 * Trust the root CA certificate in the system trust store
 */
async function trustRootCA(): Promise< void > {
	try {
		const platform = process.platform;
		if ( platform === 'win32' ) {
			// Windows - Use certutil
			await new Promise< void >( ( resolve, reject ) => {
				sudo.exec(
					`certutil -addstore -f "ROOT" "${ CA_CERT_PATH }"`,
					{ name: 'WordPress Studio' },
					( error ) => {
						if ( error ) {
							console.error( 'Error adding certificate to system trust store:', error );
							reject( error );
						} else {
							console.log( 'Root CA trusted in Windows certificate store' );
							resolve();
						}
					}
				);
			} );
		} else {
			console.error( 'Unsupported platform for certificate trust:', platform );
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
		const siteCertPath = path.join( CERT_DIRECTORY, 'domains', `${ domain }.crt` );
		const siteKeyPath = path.join( CERT_DIRECTORY, 'domains', `${ domain }.key` );

		// If the certificate already exists, no need to generate a new one
		if ( fs.existsSync( siteCertPath ) && fs.existsSync( siteKeyPath ) ) {
			return {
				cert: fs.readFileSync( siteCertPath, 'utf8' ),
				key: fs.readFileSync( siteKeyPath, 'utf8' ),
			};
		}

		const { cert: caCert, key: caKey } = await ensureRootCA();
		const caPrivateKey = forge.pki.privateKeyFromPem( caKey );
		const caCertObj = forge.pki.certificateFromPem( caCert );

		const keys = forge.pki.rsa.generateKeyPair( 2048 );
		const cert = forge.pki.createCertificate();

		cert.publicKey = keys.publicKey;
		cert.serialNumber = crypto.randomBytes( 20 ).toString( 'hex' );
		const now = new Date();
		cert.validity.notBefore = now;
		cert.validity.notAfter = new Date( now.getTime() );
		cert.validity.notAfter.setDate( now.getDate() + SITE_CERT_VALIDITY_DAYS );
		const attrs = [
			{ name: 'commonName', value: domain },
			{ name: 'countryName', value: 'US' },
			{ name: 'organizationName', value: 'WordPress Studio' },
		];
		cert.setSubject( attrs );
		cert.setIssuer( caCertObj.subject.attributes );

		cert.setExtensions( [
			{
				name: 'basicConstraints',
				cA: false,
				critical: true,
			},
			{
				name: 'keyUsage',
				critical: true,
				digitalSignature: true,
				keyEncipherment: true,
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

		const certPem = forge.pki.certificateToPem( cert );
		const keyPem = forge.pki.privateKeyToPem( keys.privateKey );
		initializeCertificatesDirectory();
		fs.writeFileSync( siteCertPath, certPem );
		fs.writeFileSync( siteKeyPath, keyPem );

		return { cert: certPem, key: keyPem };
	} catch ( error ) {
		Sentry.captureException( error );
		console.error( `Failed to generate certificate for ${ domain }:`, error );
		throw error;
	}
}
