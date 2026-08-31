import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnInit,
  Output,
  QueryList,
  ViewChildren,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

// Segmented 6-digit PIN entry: one <input> per digit, numeric-only, with
// auto-advance/backspace-back/arrow-nav/paste-split all handled here (digit
// filtering happens in code, not just the `pattern` attribute, since
// `pattern` doesn't block keystrokes). Reused across PIN login, setup,
// change, and reset — see pinService/AuthService.loginWithPin() callers.
@Component({
  selector: 'app-pin-input',
  standalone: true,
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './pin-input.component.html',
  styleUrl: './pin-input.component.scss',
})
export class PinInputComponent implements OnInit, AfterViewInit {
  @Input() length = 6;
  @Input() masked = true;
  @Input() disabled = false;
  @Output() completed = new EventEmitter<string>();
  @Output() valueChange = new EventEmitter<string>();

  @ViewChildren('cell') private cells!: QueryList<ElementRef<HTMLInputElement>>;

  readonly revealed = signal(false);
  digits: string[] = [];
  indices: number[] = [];

  get inputType(): string {
    return this.masked && !this.revealed() ? 'password' : 'text';
  }

  ngOnInit(): void {
    this.indices = Array.from({ length: this.length }, (_, i) => i);
    this.digits = Array(this.length).fill('');
  }

  ngAfterViewInit(): void {
    this.focusCell(0);
  }

  toggleReveal(): void {
    this.revealed.set(!this.revealed());
  }

  // Public — lets a parent (e.g. the PIN-setup dialog, moving focus from the
  // "new PIN" input to the "confirm PIN" input) focus this instance on demand.
  focusFirst(): void {
    this.focusCell(0);
  }

  // Public — callers clear the cells after a failed attempt (e.g. wrong PIN).
  reset(): void {
    this.digits = Array(this.length).fill('');
    this.emitChange();
    this.focusCell(0);
  }

  onInput(i: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const digit = input.value.replace(/\D/g, '').slice(-1);
    this.digits[i] = digit;
    input.value = digit;
    if (digit && i < this.length - 1) this.focusCell(i + 1);
    this.emitChange();
  }

  onKeydown(i: number, event: KeyboardEvent): void {
    if (event.key === 'Backspace' && !this.digits[i] && i > 0) {
      event.preventDefault();
      this.digits[i - 1] = '';
      this.emitChange();
      this.focusCell(i - 1);
    } else if (event.key === 'ArrowLeft' && i > 0) {
      event.preventDefault();
      this.focusCell(i - 1);
    } else if (event.key === 'ArrowRight' && i < this.length - 1) {
      event.preventDefault();
      this.focusCell(i + 1);
    }
  }

  onPaste(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text') ?? '';
    const pasted = text.replace(/\D/g, '').slice(0, this.length).split('');
    if (!pasted.length) return;
    event.preventDefault();
    this.digits = Array.from({ length: this.length }, (_, i) => pasted[i] ?? '');
    this.emitChange();
    const nextEmpty = this.digits.findIndex((d) => !d);
    this.focusCell(nextEmpty === -1 ? this.length - 1 : nextEmpty);
  }

  private focusCell(i: number): void {
    queueMicrotask(() => this.cells?.get(i)?.nativeElement.focus());
  }

  private emitChange(): void {
    const value = this.digits.join('');
    this.valueChange.emit(value);
    if (this.digits.every((d) => d !== '')) {
      this.completed.emit(value);
    }
  }
}
