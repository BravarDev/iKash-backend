import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes.enum';

export interface AppErrorResponse {
  statusCode: number;
  error: ErrorCode;
  message: string;
}

/**
 * Structured application exception.
 *
 * Every error thrown with AppException will produce a response shaped as:
 * {
 *   statusCode: number,
 *   error: ErrorCode,   // stable uppercase token — safe for frontend branching
 *   message: string     // human-readable detail
 * }
 *
 * @example
 *   throw new AppException(
 *     ErrorCode.ORDER_NOT_FOUND,
 *     'Order abc123 does not exist',
 *     HttpStatus.NOT_FOUND,
 *   );
 */
export class AppException extends HttpException {
  constructor(
    errorCode: ErrorCode,
    message: string,
    statusCode: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    const response: AppErrorResponse = {
      statusCode,
      error: errorCode,
      message,
    };
    super(response, statusCode);
  }
}
