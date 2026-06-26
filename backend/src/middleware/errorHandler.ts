import { Request, Response, NextFunction } from 'express';

// Centralised error handler. Logs the error and returns a safe JSON message.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  console.error('[error]', err);
  const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดภายในระบบ (Internal error)';
  res.status(500).json({ error: message });
}

// Wrap async route handlers so thrown errors reach errorHandler
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
