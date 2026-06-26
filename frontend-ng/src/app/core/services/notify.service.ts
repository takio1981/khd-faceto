import { Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../shared/components/confirm-dialog/confirm-dialog.component';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

@Injectable({ providedIn: 'root' })
export class NotifyService {
  constructor(private snackBar: MatSnackBar, private dialog: MatDialog) {}

  toast(message: string, type: ToastType = 'info'): void {
    this.snackBar.open(message, 'ปิด', {
      duration: type === 'error' ? 5000 : 3000,
      horizontalPosition: 'end',
      verticalPosition: 'top',
      panelClass: [`toast-${type}`],
    });
  }

  async confirm(data: ConfirmDialogData): Promise<boolean> {
    const ref = this.dialog.open(ConfirmDialogComponent, { data, width: '420px' });
    const result = await firstValueFrom(ref.afterClosed());
    return !!result;
  }
}
