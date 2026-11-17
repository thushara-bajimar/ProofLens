/**
 * An error that is safe to show to the client. Anything that is NOT an AppError
 * is treated as an internal error and its details are hidden from the response.
 */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
