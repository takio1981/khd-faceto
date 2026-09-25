import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { NotifyService } from '../services/notify.service';

// Module-level (not per-call) — a page typically fires several requests in
// parallel (dashboard summary + employees + notifications, say), all of
// which 401 together when the token expires. Without this, each one races
// past the isLoggedIn() check before the first one's clearSession() lands,
// producing 2-3 duplicate toasts for a single expiry.
let sessionExpiredToastShown = false;

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const notify = inject(NotifyService);
  const token = auth.token();

  const authReq = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authReq).pipe(
    catchError((err) => {
      if (err?.status === 401) {
        // A page that's already loaded (dashboard, employees, ...) keeps
        // firing requests with a token that has since expired (8h JWT) —
        // without this, those just show up as unexplained 401s in the
        // console while the page silently goes dead. Only toast once per
        // expiry (guarded by isLoggedIn(), which the first 401 in a burst
        // of parallel requests already flips to false for the rest).
        const wasLoggedIn = auth.isLoggedIn();
        auth.clearSession();
        if (router.url !== '/login' && router.url !== '/checkin') {
          if (wasLoggedIn && !sessionExpiredToastShown) {
            sessionExpiredToastShown = true;
            notify.toast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', 'warning');
            setTimeout(() => (sessionExpiredToastShown = false), 5000);
          }
          router.navigateByUrl('/login');
        }
      }
      return throwError(() => err);
    })
  );
};
