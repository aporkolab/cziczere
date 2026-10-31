import { Injectable, inject, OnDestroy } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Auth, idToken, user } from '@angular/fire/auth';
import { Firestore, collection, collectionData, query, where, orderBy, limit, onSnapshot, deleteDoc, doc, updateDoc, Unsubscribe } from '@angular/fire/firestore';
import { switchMap, first, Observable, of, map, BehaviorSubject } from 'rxjs';
import { environment } from '../environments/environment';

export interface MemoryData {
  id?: string;
  userId: string;
  userText: string;
  imagePrompt: string;
  imageUrl: string;
  timestamp: number;
  type: string;
  emotions: { [key: string]: number; };
}

export interface InsightData {
  id?: string; // Add optional id field
  userId: string;
  text: string;
  timestamp: number;
}

export interface PosterResponse {
  base64Image: string;
}

export interface AtmosphereData {
  weather: string;
  backgroundColor: string;
  soundUrl: string;
}

export interface PoeticRephrasingResponse {
  poeticVersion: string;
  suggestion: string;
}

export interface GardenState {
  memories: MemoryData[];
  insights: InsightData[];
  atmosphere: AtmosphereData | null;
  totalPlants: number;
  lastUpdated: Date;
  isLoading: boolean;
  error: string | null;
}

export type RealTimeUpdate = { timestamp: Date } & (
  | { type: 'memory_added'; data: MemoryData }
  | { type: 'memory_updated' | 'insight_added'; data: { count: number } }
  | { type: 'memory_deleted'; data: { id: string } }
  | { type: 'atmosphere_changed'; data: AtmosphereData }
);

@Injectable({
  providedIn: 'root'
})
export class ApiService implements OnDestroy {
  private auth: Auth = inject(Auth);
  private firestore: Firestore = inject(Firestore);
  private http: HttpClient = inject(HttpClient);
  user$ = user(this.auth);

  // Real-time state management
  private gardenStateSubject = new BehaviorSubject<GardenState>({
    memories: [],
    insights: [],
    atmosphere: null,
    totalPlants: 0,
    lastUpdated: new Date(),
    isLoading: false,
    error: null
  });
  
  public gardenState$ = this.gardenStateSubject.asObservable();
  private updatesSubject = new BehaviorSubject<RealTimeUpdate | null>(null);
  public updates$ = this.updatesSubject.asObservable();
  
  // Firestore listeners
  private memoriesUnsubscribe?: Unsubscribe;
  private insightsUnsubscribe?: Unsubscribe;

  // Use environment configuration
  private generateFunctionUrl = environment.apis.generateMemoryPlant;
  private analyzeFunctionUrl = environment.apis.analyzeMemories;
  private atmosphereFunctionUrl = environment.apis.getAtmosphere;
  private exportGardenFunctionUrl = environment.apis.exportGarden;
  private insightAudioFunctionUrl = environment.apis.getInsightAudio;
  private poeticRephrasingUrl = environment.apis.poeticRephrasing;

  constructor() {
    // Initialize real-time listeners when user state changes
    this.user$.subscribe(currentUser => {
      if (currentUser) {
        this.initializeRealTimeListeners(currentUser.uid);
      } else {
        this.cleanup();
        this.resetGardenState();
      }
    });
  }


  getInsightAudioUrl(insightId: string): Observable<{audioUrl: string}> {
    return idToken(this.auth).pipe(
      first(),
      switchMap(token => {
        if (!token) {
          throw new Error('User not logged in!');
        }
        const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
        const params = { insightId };
        return this.http.get<{audioUrl: string}>(this.insightAudioFunctionUrl, { headers, params });
      })
    );
  }

  exportGardenAsPoster(): Observable<PosterResponse> {
    return idToken(this.auth).pipe(
      first(),
      switchMap(token => {
        if (!token) {
          throw new Error('User not logged in!');
        }
        const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
        return this.http.post<PosterResponse>(this.exportGardenFunctionUrl, {}, { headers });
      })
    );
  }

  getAtmosphere(): Observable<AtmosphereData> {
    return idToken(this.auth).pipe(
      first(),
      switchMap(token => {
        if (!token) {
          throw new Error('User not logged in!');
        }
        const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
        return this.http.post<AtmosphereData>(this.atmosphereFunctionUrl, {}, { headers });
      })
    );
  }

  createMemory(text: string): Observable<MemoryData> {
    return idToken(this.auth).pipe(
      first(),
      switchMap(token => {
        if (!token) {
          throw new Error('User not logged in!');
        }

        const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
        const body = { text };
        return this.http.post<MemoryData>(this.generateFunctionUrl, body, { headers });
      })
    );
  }

  requestInsight(type: 'insight' | 'weekly' | 'monthly' = 'insight'): Observable<InsightData> {
    return idToken(this.auth).pipe(
      first(),
      switchMap(token => {
        if (!token) {
          throw new Error('User not logged in!');
        }
        const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
        const params = { type };
        return this.http.post<InsightData>(this.analyzeFunctionUrl, {}, { headers, params });
      })
    );
  }

  getLatestInsight(): Observable<InsightData | null> {
    return this.user$.pipe(
      switchMap(currentUser => {
        if (!currentUser) {
          return of(null);
        }
        const insightsCollection = collection(this.firestore, 'insights');
        const q = query(
          insightsCollection,
          where('userId', '==', currentUser.uid),
          orderBy('timestamp', 'desc'),
          limit(1)
        );
        return collectionData(q, { idField: 'id' }).pipe(
          map(insights => (insights.length > 0 ? insights[0] as InsightData : null))
        );
      })
    );
  }

  getMemories(): Observable<MemoryData[]> {
    return this.user$.pipe(
      switchMap(currentUser => {
        if (!currentUser) {
          return of([]); // Return empty array if no user
        }
        const memoriesCollection = collection(this.firestore, 'memories');
        const q = query(memoriesCollection, where('userId', '==', currentUser.uid));
        return collectionData(q) as Observable<MemoryData[]>;
      })
    );
  }

  getPoeticRephrasing(originalText: string): Observable<PoeticRephrasingResponse> {
    return idToken(this.auth).pipe(
      first(),
      switchMap(token => {
        if (!token) {
          throw new Error('User not logged in!');
        }
        const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
        const body = { originalText };
        return this.http.post<PoeticRephrasingResponse>(this.poeticRephrasingUrl, body, { headers });
      })
    );
  }

  // Real-time listeners initialization
  private initializeRealTimeListeners(userId: string): void {
    this.cleanup(); // Clean up existing listeners
    this.setLoading(true);

    // Set up memories listener
    const memoriesCollection = collection(this.firestore, 'memories');
    const memoriesQuery = query(
      memoriesCollection,
      where('userId', '==', userId),
      orderBy('timestamp', 'desc')
    );

    this.memoriesUnsubscribe = onSnapshot(memoriesQuery, 
      (snapshot) => {
        const memories = snapshot.docs.map(doc => ({
          ...(doc.data() as MemoryData),
          id: doc.id
        }));
        
        this.updateGardenState({
          memories,
          totalPlants: memories.length,
          lastUpdated: new Date(),
          isLoading: false,
          error: null
        });

        // Emit update event
        this.updatesSubject.next({
          type: 'memory_updated',
          data: { count: memories.length },
          timestamp: new Date()
        });
      },
      (error) => {
        console.error('Error listening to memories:', error);
        this.updateGardenState({ 
          error: 'Failed to load memories',
          isLoading: false 
        });
      }
    );

    // Set up insights listener
    const insightsCollection = collection(this.firestore, 'insights');
    const insightsQuery = query(
      insightsCollection,
      where('userId', '==', userId),
      orderBy('timestamp', 'desc'),
      limit(10)
    );

    this.insightsUnsubscribe = onSnapshot(insightsQuery,
      (snapshot) => {
        const insights: InsightData[] = [];
        snapshot.forEach(doc => {
          insights.push({ ...doc.data(), id: doc.id } as InsightData);
        });
        
        this.updateGardenState({ insights });
        
        // Emit update event
        this.updatesSubject.next({
          type: 'insight_added',
          data: { count: insights.length },
          timestamp: new Date()
        });
      },
      (error) => {
        console.error('Error listening to insights:', error);
      }
    );

    // Load atmosphere on initialization
    this.refreshAtmosphere();
  }

  private updateGardenState(partialState: Partial<GardenState>): void {
    const currentState = this.gardenStateSubject.value;
    this.gardenStateSubject.next({
      ...currentState,
      ...partialState
    });
  }

  private setLoading(loading: boolean): void {
    this.updateGardenState({ isLoading: loading });
  }

  private resetGardenState(): void {
    this.gardenStateSubject.next({
      memories: [],
      insights: [],
      atmosphere: null,
      totalPlants: 0,
      lastUpdated: new Date(),
      isLoading: false,
      error: null
    });
  }

  private cleanup(): void {
    if (this.memoriesUnsubscribe) {
      this.memoriesUnsubscribe();
      this.memoriesUnsubscribe = undefined;
    }
    if (this.insightsUnsubscribe) {
      this.insightsUnsubscribe();
      this.insightsUnsubscribe = undefined;
    }
  }

  // Enhanced methods with real-time updates
  refreshAtmosphere(): void {
    this.getAtmosphere().subscribe({
      next: (atmosphere) => {
        this.updateGardenState({ atmosphere });
        this.updatesSubject.next({
          type: 'atmosphere_changed',
          data: atmosphere,
          timestamp: new Date()
        });
      },
      error: (error) => {
        console.error('Error refreshing atmosphere:', error);
      }
    });
  }

  // Memory management with real-time updates
  deleteMemory(memoryId: string): Observable<void> {
    const memoryDoc = doc(this.firestore, 'memories', memoryId);
    return new Observable(observer => {
      deleteDoc(memoryDoc).then(() => {
        this.updatesSubject.next({
          type: 'memory_deleted',
          data: { id: memoryId },
          timestamp: new Date()
        });
        observer.next();
        observer.complete();
      }).catch(error => {
        observer.error(error);
      });
    });
  }

  updateMemory(memoryId: string, updates: Partial<MemoryData>): Observable<void> {
    const memoryDoc = doc(this.firestore, 'memories', memoryId);
    return new Observable(observer => {
      updateDoc(memoryDoc, updates).then(() => {
        observer.next();
        observer.complete();
      }).catch(error => {
        observer.error(error);
      });
    });
  }

  // Get current garden state synchronously
  getCurrentGardenState(): GardenState {
    return this.gardenStateSubject.value;
  }

  // Enhanced memory creation with optimistic updates
  createMemoryWithOptimisticUpdate(text: string): Observable<MemoryData> {
    // Create optimistic memory
    const optimisticMemory: MemoryData = {
      userId: this.auth.currentUser?.uid || '',
      userText: text,
      imagePrompt: 'Generating...',
      imageUrl: '',
      timestamp: Date.now(),
      type: 'memory',
      emotions: {}
    };

    // Add optimistic update
    const currentState = this.getCurrentGardenState();
    this.updateGardenState({
      memories: [optimisticMemory, ...currentState.memories],
      totalPlants: currentState.totalPlants + 1
    });

    return this.createMemory(text);
  }

  ngOnDestroy(): void {
    this.cleanup();
  }
}
