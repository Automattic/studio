// Polyfills for browser globals in Node.js environment
if ( typeof window === 'undefined' ) {
	global.window = {
		addEventListener: () => {},
		removeEventListener: () => {},
		location: { href: '' },
		document: {},
	};
}

if ( typeof document === 'undefined' ) {
	global.document = {
		createElement: () => ( {} ),
		addEventListener: () => {},
	};
}

if ( typeof navigator === 'undefined' ) {
	global.navigator = {
		userAgent: 'Node.js',
	};
}
