import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Auth, User, user, GoogleAuthProvider, signInWithPopup, signOut } from '@angular/fire/auth';
import { Firestore, doc, setDoc } from '@angular/fire/firestore';
import { Observable, of, BehaviorSubject } from 'rxjs';
import { catchError, switchMap, tap } from 'rxjs/operators';

import { GardenComponent } from './garden/garden.component';
import { MemoryCreateComponent } from './memory-create/memory-create.component';
import { InsightDisplayComponent } from './insight-display/insight-display.component';
import { MemoryDetailComponent } from './memory-detail/memory-detail.component';
import { ArViewComponent } from './ar-view/ar-view.component';
import { ApiService, InsightData, MemoryData } from './api.service';
import { ArStateService } from './ar-state.service';
import { NotificationService } from './notification.service';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  standalone: true,
  imports: [CommonModule, GardenComponent, MemoryCreateComponent, InsightDisplayComponent, MemoryDetailComponent, ArViewComponent]
})
export class AppComponent implements OnInit {
  private auth: Auth = inject(Auth);
  private apiService: ApiService = inject(ApiService);
  private arStateService: ArStateService = inject(ArStateService);
  private firestore: Firestore = inject(Firestore);
  private notificationService: NotificationService = inject(NotificationService);

  user: Observable<User | null> = user(this.auth);

  memories$: Observable<MemoryData[]>;
  latestInsight$: Observable<InsightData | null | undefined>;
  selectedMemoryForDetail: MemoryData | null = null;

  isLoading$ = new BehaviorSubject<boolean>(false);
  isInsightLoading$ = new BehaviorSubject<boolean>(false);
  isExporting$ = new BehaviorSubject<boolean>(false);
  isArViewVisible = false;
  insightError$ = new BehaviorSubject<string | null>(null);
  memoryError$ = new BehaviorSubject<string | null>(null);
  showMemoryForm = false; // Controls floating form visibility

  constructor() {
    this.memories$ = this.apiService.getMemories();
    this.latestInsight$ = of(undefined);
  }

  ngOnInit(): void {
    this.fetchLatestInsight();
  }

  login() {
    signInWithPopup(this.auth, new GoogleAuthProvider()).then(result => {
      if (environment.features.enableNotifications) {
        this.notificationService.requestPermission();
        this.notificationService.listenForMessages();
        const userDoc = doc(this.firestore, `users/${result.user.uid}`);
        setDoc(userDoc, { lastActive: Date.now() }, { merge: true });
      }
    });
  }

  logout() {
    signOut(this.auth);
  }

  toggleMemoryForm() {
    this.showMemoryForm = !this.showMemoryForm;
  }
  
  onMemorySubmit(memoryText: string) {
    this.isLoading$.next(true);
    this.memoryError$.next(null);
    
    this.apiService.createMemory(memoryText).subscribe({
      next: (newMemory) => {
        this.isLoading$.next(false);
        this.showMemoryForm = false; // Hide form after successful submission
        // Also update the user's last active timestamp
        const user = this.auth.currentUser;
        if (user && environment.features.enableNotifications) {
          const userDoc = doc(this.firestore, `users/${user.uid}`);
          setDoc(userDoc, { lastActive: newMemory.timestamp }, { merge: true });
        }
      },
      error: (err) => {
        console.error('Memory creation failed:', err);
        this.isLoading$.next(false);
        this.memoryError$.next('Failed to create memory. Please try again later.');
      }
    });
  }

  fetchLatestInsight(): void {
    this.isInsightLoading$.next(true);
    this.insightError$.next(null);
    this.latestInsight$ = this.apiService.getLatestInsight().pipe(
      catchError(err => {
        console.error('Error fetching latest insight:', err);
        this.insightError$.next('Could not load the latest insight.');
        return of(null);
      }),
      tap(() => this.isInsightLoading$.next(false))
    );
  }

  requestInsight(type: 'insight' | 'weekly' | 'monthly' = 'insight'): void {
    this.isInsightLoading$.next(true);
    this.insightError$.next(null);
    this.latestInsight$ = of(undefined);

    this.apiService.requestInsight(type).pipe(
      catchError(err => {
        console.error('Error requesting new insight:', err);
        this.insightError$.next('Failed to generate a new insight. There may be no memories to analyze yet.');
        return of(null);
      }),
      switchMap(() => this.apiService.getLatestInsight()),
      tap(() => this.isInsightLoading$.next(false))
    ).subscribe(insight => {
        this.latestInsight$ = of(insight);
    });
  }

  onMemoryClicked(memory: MemoryData) {
    this.selectedMemoryForDetail = memory;
  }

  onDetailClose() {
    this.selectedMemoryForDetail = null;
  }

  enterArModeForMemory(memory: MemoryData) {
    this.arStateService.setSelectedMemory(memory);
    this.isArViewVisible = true;
    this.onDetailClose(); // Close detail view if it's open
  }

  exitArMode() {
    this.arStateService.setSelectedMemory(null);
    this.isArViewVisible = false;
  }

  onArMemorySelected(memory: MemoryData) {
    this.selectedMemoryForDetail = memory;
  }
}
