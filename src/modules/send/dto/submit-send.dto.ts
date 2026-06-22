import { IsString, MinLength } from 'class-validator';

export class SubmitSendDto {
  // XDR of the transaction already signed by the frontend
  @IsString()
  @MinLength(1)
  signedXdr!: string;
}
