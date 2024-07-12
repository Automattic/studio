import { Validator } from './Validator';
import { JetpackValidator } from './jetpack-validator';
import { SqlValidator } from './sql-validator';

export * from './Validator';
export * from './jetpack-validator';

export const allValidators: Validator[] = [ new SqlValidator(), new JetpackValidator() ];
