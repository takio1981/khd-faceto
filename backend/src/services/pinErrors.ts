// Shared error taxonomy for PIN login/device services (pinAuth.service.ts,
// device.service.ts) — kept in one file since both services need to
// recognize/throw the same conditions and routes need to catch them by type.
export class PinNotConfiguredError extends Error {}
export class PinAlreadyConfiguredError extends Error {}
export class PinIncorrectError extends Error {}
export class PinLockedError extends Error {
  constructor(public lockedUntil: Date) {
    super('PIN locked');
  }
}
export class DeviceLimitReachedError extends Error {}
