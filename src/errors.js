export class AppError extends Error {
  constructor(status, message, code = 'REQUEST_FAILED') { super(message); this.status = status; this.code = code; }
}
export const unavailable = message => new AppError(503, message, 'SERVICE_UNAVAILABLE');
