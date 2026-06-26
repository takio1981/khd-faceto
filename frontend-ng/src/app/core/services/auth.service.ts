import { HttpClient } from '@angular/common/http';
import { Injectable, computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { LoginResponse, Role } from '../models/models';

const TOKEN_KEY = 'token';
const ROLE_KEY = 'role';
const USERNAME_KEY = 'username';
const EMPLOYEE_ID_KEY = 'employeeId';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly tokenSig = signal<string | null>(localStorage.getItem(TOKEN_KEY));
  private readonly roleSig = signal<Role | null>(localStorage.getItem(ROLE_KEY) as Role | null);
  private readonly usernameSig = signal<string | null>(localStorage.getItem(USERNAME_KEY));

  readonly isLoggedIn = computed(() => !!this.tokenSig());
  readonly role = computed(() => this.roleSig());
  readonly username = computed(() => this.usernameSig());
  readonly isAdmin = computed(() => this.roleSig() === 'admin');

  constructor(private http: HttpClient, private router: Router) {}

  token(): string | null {
    return this.tokenSig();
  }

  employeeId(): number | null {
    const v = localStorage.getItem(EMPLOYEE_ID_KEY);
    return v ? Number(v) : null;
  }

  login(username: string, password: string): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${environment.apiBaseUrl}/auth/login`, { username, password })
      .pipe(tap((res) => this.setSession(res)));
  }

  setSession(res: LoginResponse): void {
    localStorage.setItem(TOKEN_KEY, res.accessToken);
    localStorage.setItem(ROLE_KEY, res.role);
    localStorage.setItem(USERNAME_KEY, res.username);
    if (res.employeeId != null) {
      localStorage.setItem(EMPLOYEE_ID_KEY, String(res.employeeId));
    } else {
      localStorage.removeItem(EMPLOYEE_ID_KEY);
    }
    this.tokenSig.set(res.accessToken);
    this.roleSig.set(res.role);
    this.usernameSig.set(res.username);
  }

  clearSession(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
    localStorage.removeItem(USERNAME_KEY);
    localStorage.removeItem(EMPLOYEE_ID_KEY);
    this.tokenSig.set(null);
    this.roleSig.set(null);
    this.usernameSig.set(null);
  }

  logout(): void {
    this.clearSession();
    this.router.navigateByUrl('/login');
  }
}
