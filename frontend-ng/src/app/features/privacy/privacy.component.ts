import { Component, OnInit, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { RouterLink } from '@angular/router';
import { ConfigService } from '../../core/services/config.service';

@Component({
  selector: 'app-privacy',
  standalone: true,
  imports: [MatCardModule, MatButtonModule, RouterLink],
  templateUrl: './privacy.component.html',
  styleUrl: './privacy.component.scss',
})
export class PrivacyComponent implements OnInit {
  private configService = inject(ConfigService);

  readonly companyName = signal('สำนักงานสาธารณสุขจังหวัดนครราชสีมา');
  readonly appName = signal('ระบบลงเวลา KHD-FaceTo');

  ngOnInit(): void {
    this.configService.get().subscribe({
      next: (c) => {
        if (c.companyName) this.companyName.set(c.companyName);
        if (c.appName) this.appName.set(c.appName);
      },
      error: () => {},
    });
  }
}

export default PrivacyComponent;
