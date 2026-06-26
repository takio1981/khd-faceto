import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { CommonModule } from '@angular/common';
import { Component, ContentChild, Input, OnDestroy, OnInit, TemplateRef, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { Subscription } from 'rxjs';

export interface TableColumn {
  key: string;
  label: string;
  /** Hide this column's value in the mobile stacked-card view (e.g. it's used elsewhere, like a title). */
  hideOnCard?: boolean;
}

/**
 * Reusable responsive list renderer: a real <table> on desktop/tablet, and a
 * stacked mat-card key/value list per row once the viewport drops to
 * Handset — replacing the old CSS `data-label` stacking hack with an actual
 * layout switch, so there is never a horizontal scrollbar on phones.
 *
 * Usage: project two ng-templates with #desktopRow and #cardRow context { row }.
 */
@Component({
  selector: 'app-responsive-table',
  standalone: true,
  imports: [CommonModule, MatCardModule],
  templateUrl: './responsive-table.component.html',
  styleUrl: './responsive-table.component.scss',
})
export class ResponsiveTableComponent<T> implements OnInit, OnDestroy {
  @Input({ required: true }) columns: TableColumn[] = [];
  @Input({ required: true }) data: T[] = [];
  @Input() trackByFn: (index: number, item: T) => any = (i) => i;

  @ContentChild('desktopRow') desktopRowTpl?: TemplateRef<{ $implicit: T }>;
  @ContentChild('cardRow') cardRowTpl?: TemplateRef<{ $implicit: T }>;
  @ContentChild('cardActions') cardActionsTpl?: TemplateRef<{ $implicit: T }>;

  readonly isMobile = signal(false);
  private sub?: Subscription;

  constructor(private breakpointObserver: BreakpointObserver) {}

  ngOnInit(): void {
    this.sub = this.breakpointObserver
      .observe([Breakpoints.Handset, Breakpoints.TabletPortrait])
      .subscribe((result) => this.isMobile.set(result.matches));
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  get displayedColumns(): string[] {
    return this.columns.map((c) => c.key);
  }
}
