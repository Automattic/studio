import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { domainToASCII } from 'node:url';
import { promisify } from 'node:util';
import { CERT_UNTRUSTED_ROOT, SERVER_AUTH_OID } from '@studio/common/constants';
import {
	buildLinuxTrustInstallCommand,
	importCAIntoUserNssDbsLinux,
	isCAImportedInUserNssDbsLinux,
	isCATrustedOnLinux,
} from '@studio/common/lib/linux-trust-store';
import { getCertificatesPath } from '@studio/common/lib/well-known-paths';
import sudo from '@vscode/sudo-prompt';
import { __ } from '@wordpress/i18n';
import forge from 'node-forge';

const execFilePromise = promisify( execFile );

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
const CERT_DIRECTORY = getCertificatesPath();
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

	console.log( 'Generating new root CA certificate…' );

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

	cert.setExtensions( [
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
	] );

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

/**
 * Checks if the root CA certificate is already trusted by the system
 * @returns A promise that resolves to true if the certificate is trusted, false otherwise
 */
export async function isRootCATrusted(): Promise< boolean > {
	if ( ! fs.existsSync( CA_CERT_PATH ) ) {
		return false;
	}

	if ( process.platform === 'win32' ) {
		try {
			const { stdout } = await execFilePromise( 'certutil', [ '-verify', CA_CERT_PATH ] );

			const isTrusted = ! stdout.includes( CERT_UNTRUSTED_ROOT );
			const hasServerAuthPolicy = stdout.includes( SERVER_AUTH_OID );

			return isTrusted && hasServerAuthPolicy;
		} catch ( error ) {
			return false;
		}
	} else if ( process.platform === 'darwin' ) {
		try {
			await execFilePromise( 'security', [ 'verify-cert', '-r', CA_CERT_PATH, '-p', 'ssl' ] );

			return true;
		} catch ( error ) {
			return false;
		}
	} else if ( process.platform === 'linux' ) {
		// The CA is fully trusted on Linux only when it lives in both the system
		// bundle (covers curl/openssl/Node) AND every NSS DB candidate (covers
		// Chromium-family browsers, including Snap-Chromium's sandboxed DB).
		return (
			( await isCATrustedOnLinux( CA_CERT_PATH ) ) && ( await isCAImportedInUserNssDbsLinux() )
		);
	}

	return false;
}

/**
 * Trust the root CA certificate in the system trust store
 * @throws { Error } If the certificate trust operation fails
 */
export async function trustRootCA(): Promise< void > {
	try {
		// If certificate is already trusted, no need to re-trust it
		if ( await isRootCATrusted() ) {
			console.log( 'Root CA is already trusted in the system store' );
			return;
		}

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
		} else if ( platform === 'linux' ) {
			// Skip the sudo install when the system bundle is already trusted —
			// otherwise we'd reprompt for the polkit password just to re-sync NSS
			// (the common case when a Chromium-family browser is installed after
			// the initial trust flow).
			if ( ! ( await isCATrustedOnLinux( CA_CERT_PATH ) ) ) {
				await new Promise< void >( ( resolve, reject ) => {
					sudo.exec(
						buildLinuxTrustInstallCommand( CA_CERT_PATH ),
						{ name: 'WordPress Studio' },
						( error ) => {
							if ( error ) {
								console.error( 'Error adding certificate to system trust store:', error );
								reject( error );
							} else {
								console.log( 'Root CA trusted in Linux system trust store' );
								resolve();
							}
						}
					);
				} );
			}
			// Always run NSS imports — they're idempotent (-D before -A) and don't
			// need sudo, so re-running covers the install-browser-after-trust case.
			await importCAIntoUserNssDbsLinux( CA_CERT_PATH );
		} else {
			console.error( 'Unsupported platform for automatic certificate trust:', platform );
		}
	} catch ( error ) {
		console.error( 'Failed to trust root CA:', error );
		throw error;
	}
}

/**
 * Generate a certificate for a site domain signed by our CA
 */
export async function generateSiteCertificate(
	domain: string
): Promise< { cert: string; key: string } > {
	try {
		const punycodeDomain = domainToASCII( domain );
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
			{ name: 'commonName', value: punycodeDomain },
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
						value: punycodeDomain,
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
		console.error( `Failed to generate certificate for ${ domain }:`, error );
		throw error;
	}
}

/**
 * Delete the certificate files for a specific domain
 */
export function deleteSiteCertificate( domain: string ): boolean {
	try {
		const siteCertPath = path.join( CERT_DIRECTORY, 'domains', `${ domain }.crt` );
		const siteKeyPath = path.join( CERT_DIRECTORY, 'domains', `${ domain }.key` );
		let deletedFiles = false;
		if ( fs.existsSync( siteCertPath ) ) {
			fs.unlinkSync( siteCertPath );
			deletedFiles = true;
		}
		if ( fs.existsSync( siteKeyPath ) ) {
			fs.unlinkSync( siteKeyPath );
			deletedFiles = true;
		}

		return deletedFiles;
	} catch ( error ) {
		console.error( `Failed to delete certificate for ${ domain }:`, error );
		return false;
	}
}
