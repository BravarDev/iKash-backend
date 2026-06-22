import { IsString, Matches, MaxLength } from 'class-validator';
import { ALIAS_REGEX } from '../../../lib/constants/regex';

export class ValidateAliasDto {
  @IsString()
  @MaxLength(80)
  @Matches(ALIAS_REGEX, { message: 'Alias must only contain lowercase letters, numbers, and allowed symbols (., !, _)' })
  alias: string;
}
