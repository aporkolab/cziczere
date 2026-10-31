import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MemoryData } from '../api.service';

@Component({
  selector: 'app-memory-detail',
  templateUrl: './memory-detail.component.html',
  styleUrls: ['./memory-detail.component.css'],
  standalone: true,
  imports: [CommonModule]
})
export class MemoryDetailComponent {
  @Input() memory: MemoryData | null = null;
  @Output() dismissed = new EventEmitter<void>();
  @Output() enterAr = new EventEmitter<MemoryData>();

  get emotionsArray() {
    if (!this.memory?.emotions) {
      return [];
    }
    return Object.entries(this.memory.emotions).sort((a, b) => b[1] - a[1]);
  }

  onClose() {
    this.dismissed.emit();
  }

  onEnterAr() {
    if (this.memory) {
      this.enterAr.emit(this.memory);
    }
  }
}
