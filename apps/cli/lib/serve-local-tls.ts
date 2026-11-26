import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import path from 'node:path';
import httpProxy from 'http-proxy';
import forge from 'node-forge';

/**
 * Keeps a cloud machine's requests to its own sites on the machine. Each site's public host
 * resolves to 127.0.0.1 here (`/etc/hosts`), where `studio serve` answers HTTPS with a certificate
 * from the machine's own authority, which the processes it starts trust. WordPress calling itself,
 * the agent's browser and its shell then reach the sites without going out through the gateway,
 * and `studio serve` can tell them apart from requests from the internet, which need access.
 */

const SYSTEM_BUNDLE = '/etc/ssl/certs/ca-certificates.crt';
const HOSTS_FILE = '/etc/hosts';
const HOSTS_START = '# studio serve: sites on this machine';
const HOSTS_END = '# end of studio serve sites';
const VALIDITY_YEARS = 5;

interface MachineTls {
	cert: string;
	key: string;
	// The authority's certificate, and it appended to the system's trusted ones.
	caPath: string;
	bundlePath: string;
	// A directory of PHP settings that point PHP at the bundle (`PHP_INI_SCAN_DIR`).
	phpIniDir: string;
}

function issue(
	subject: string,
	publicKey: forge.pki.PublicKey,
	signer: forge.pki.rsa.PrivateKey,
	issuer: forge.pki.CertificateField[] | null,
	extensions: object[]
): forge.pki.Certificate {
	const cert = forge.pki.createCertificate();
	cert.publicKey = publicKey;
	cert.serialNumber = `01${ randomBytes( 16 ).toString( 'hex' ) }`;
	cert.validity.notBefore = new Date( Date.now() - 60_000 );
	cert.validity.notAfter = new Date();
	cert.validity.notAfter.setFullYear( cert.validity.notAfter.getFullYear() + VALIDITY_YEARS );
	const attributes = [ { name: 'commonName', value: subject } ];
	cert.setSubject( attributes );
	cert.setIssuer( issuer ?? attributes );
	cert.setExtensions( extensions );
	cert.sign( signer, forge.md.sha256.create() );
	return cert;
}

/** The machine's authority and its certificate for `*.<domain>`, created once in `directory`. */
export function ensureMachineTls( directory: string, domain: string ): MachineTls {
	const certPath = path.join( directory, 'server.crt' );
	const keyPath = path.join( directory, 'server.key' );
	const caPath = path.join( directory, 'ca.crt' );
	const bundlePath = path.join( directory, 'ca-bundle.crt' );

	if ( ! fs.existsSync( certPath ) || ! fs.existsSync( keyPath ) || ! fs.existsSync( caPath ) ) {
		fs.mkdirSync( directory, { recursive: true, mode: 0o700 } );
		const caKeys = forge.pki.rsa.generateKeyPair( 2048 );
		const ca = issue( 'WordPress Studio Cloud machine', caKeys.publicKey, caKeys.privateKey, null, [
			{ name: 'basicConstraints', cA: true, critical: true, pathLenConstraint: 0 },
			{ name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
		] );
		const keys = forge.pki.rsa.generateKeyPair( 2048 );
		const server = issue(
			`*.${ domain }`,
			keys.publicKey,
			caKeys.privateKey,
			ca.subject.attributes,
			[
				{ name: 'basicConstraints', cA: false, critical: true },
				{ name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
				{ name: 'extKeyUsage', serverAuth: true },
				{ name: 'subjectAltName', altNames: [ { type: 2, value: `*.${ domain }` } ] },
			]
		);
		fs.writeFileSync( caPath, forge.pki.certificateToPem( ca ) );
		fs.writeFileSync( certPath, forge.pki.certificateToPem( server ) );
		fs.writeFileSync( keyPath, forge.pki.privateKeyToPem( keys.privateKey ), { mode: 0o600 } );
	}

	const system = fs.existsSync( SYSTEM_BUNDLE ) ? fs.readFileSync( SYSTEM_BUNDLE, 'utf8' ) : '';
	fs.writeFileSync( bundlePath, `${ system }\n${ fs.readFileSync( caPath, 'utf8' ) }` );
	// Studio's php.ini pins PHP to its own bundle, which a later file in the scan directory overrides.
	const phpIniDir = path.join( directory, 'php' );
	fs.mkdirSync( phpIniDir, { recursive: true } );
	fs.writeFileSync(
		path.join( phpIniDir, 'zz-machine-ca.ini' ),
		`openssl.cafile="${ bundlePath }"\ncurl.cainfo="${ bundlePath }"\n`
	);

	return {
		cert: fs.readFileSync( certPath, 'utf8' ),
		key: fs.readFileSync( keyPath, 'utf8' ),
		caPath,
		bundlePath,
		phpIniDir,
	};
}

/** HTTPS on 127.0.0.1:443, forwarded to `studio serve` itself. */
export function startLocalTls( tls: MachineTls, targetPort: number ): Promise< void > {
	const proxy = httpProxy.createProxyServer( { xfwd: true } );
	proxy.on( 'error', ( _error, _req, res ) => {
		if ( 'writeHead' in res && ! res.headersSent ) {
			res.writeHead( 502 );
			res.end();
		}
	} );
	const server = createHttpsServer( { cert: tls.cert, key: tls.key }, ( req, res ) =>
		proxy.web( req, res, { target: `http://127.0.0.1:${ targetPort }` } )
	);
	// Both loopback addresses, as the hosts file gives both: a client that prefers IPv6 would
	// otherwise look the site up publicly and go out through the gateway.
	return new Promise( ( resolve, reject ) => {
		server.once( 'error', reject );
		server.listen( 443, '::1', () => {
			server.off( 'error', reject );
			const ipv4 = createHttpsServer( { cert: tls.cert, key: tls.key }, ( req, res ) =>
				proxy.web( req, res, { target: `http://127.0.0.1:${ targetPort }` } )
			);
			ipv4.once( 'error', reject );
			ipv4.listen( 443, '127.0.0.1', () => resolve() );
		} );
	} );
}

/** Points the given hosts at the loopback addresses, in a block of `/etc/hosts` it owns. */
export function syncHostsFile( hosts: string[] ): void {
	const current = fs.readFileSync( HOSTS_FILE, 'utf8' );
	const start = current.indexOf( HOSTS_START );
	const end = current.indexOf( HOSTS_END );
	const rest =
		start === -1 || end === -1
			? current.trimEnd()
			: `${ current.slice( 0, start ) }${ current.slice( end + HOSTS_END.length ) }`.trimEnd();
	const block = [
		HOSTS_START,
		...hosts.flatMap( ( host ) => [ `127.0.0.1 ${ host }`, `::1 ${ host }` ] ),
		HOSTS_END,
	];
	const next = `${ rest }\n${ block.join( '\n' ) }\n`;
	if ( next !== current ) {
		fs.writeFileSync( HOSTS_FILE, next );
	}
}
