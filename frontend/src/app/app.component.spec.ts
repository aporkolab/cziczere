import { Auth } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { of } from 'rxjs';
import { ApiService } from './api.service';
import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        { provide: Auth, useValue: {
          currentUser: null,
          onIdTokenChanged: (next: (value: null) => void) => { next(null); return () => {}; }
        } },
        { provide: Firestore, useValue: {} },
        { provide: ApiService, useValue: { getMemories: () => of([]) } }
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });
});
