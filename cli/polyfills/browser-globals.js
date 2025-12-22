// Polyfills for browser globals in Node.js environment
if ( typeof window === 'undefined' ) {
	global.window = {
		addEventListener: () => {},
		removeEventListener: () => {},
		location: { href: '' },
		document: {},
		Blob: class Blob {},
		File: class File {},
	};
}

if ( typeof document === 'undefined' ) {
	global.document = {
		createElement: () => ( {} ),
		addEventListener: () => {},
		baseURI: 'file:///',
	};
}

if ( typeof navigator === 'undefined' ) {
	global.navigator = {
		userAgent: 'Node.js',
	};
}
