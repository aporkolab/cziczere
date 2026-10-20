import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ApiService } from '../api.service';

import { MemoryCreateComponent } from './memory-create.component';

describe('MemoryCreateComponent', () => {
  let component: MemoryCreateComponent;
  let fixture: ComponentFixture<MemoryCreateComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [MemoryCreateComponent],
      providers: [{ provide: ApiService, useValue: {} }]
    });
    fixture = TestBed.createComponent(MemoryCreateComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
