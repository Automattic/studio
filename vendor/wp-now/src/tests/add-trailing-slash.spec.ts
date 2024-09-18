import { addTrailingSlash } from '../add-trailing-slash';

describe( 'add trailing slash middleware', () => {
	const middlewareTrailingSlash = addTrailingSlash( '/wp-admin' );
	let res, next;

	beforeEach( () => {
		res = {
			redirect: vi.fn(),
		};
		next = vi.fn();
	} );

	test( 'adds a trailing slash to the given path', () => {
		const req = { url: '/wp-admin' };
		middlewareTrailingSlash( req, res, next );
		expect( res.redirect ).toHaveBeenCalledWith( 301, '/wp-admin/' );
		expect( next ).not.toHaveBeenCalled();
	} );

	test( 'adds a trailing slash to the given path with parameters', () => {
		const req = { url: '/wp-admin?foo=bar' };
		middlewareTrailingSlash( req, res, next );
		expect( res.redirect ).toHaveBeenCalledWith( 301, '/wp-admin/?foo=bar' );
		expect( next ).not.toHaveBeenCalled();
	} );

	test( 'does not add a trailing slash to the given path', () => {
		const req = { url: '/wp-admin/' };
		middlewareTrailingSlash( req, res, next );
		expect( res.redirect ).not.toHaveBeenCalled();
		expect( next ).toHaveBeenCalled();
	} );
} );
