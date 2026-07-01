export function isErrnoException( value: unknown ): value is NodeJS.ErrnoException {
	return (
		value instanceof Error &&
		( ! ( 'errno' in value ) ||
			typeof value[ 'errno' ] === 'number' ||
			typeof value[ 'errno' ] === 'undefined' ) &&
		( ! ( 'code' in value ) ||
			typeof value[ 'code' ] === 'string' ||
			typeof value[ 'code' ] === 'undefined' ) &&
		( ! ( 'path' in value ) ||
			typeof value[ 'path' ] === 'string' ||
			typeof value[ 'path' ] === 'undefined' ) &&
		( ! ( 'syscall' in value ) ||
			typeof value[ 'syscall' ] === 'string' ||
			typeof value[ 'syscall' ] === 'undefined' )
	);
}
