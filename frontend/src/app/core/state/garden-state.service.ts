import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, distinctUntilChanged, map, shareReplay } from 'rxjs';
import { MemoryData, InsightData, AtmosphereData } from '../../api.service';
import { environment } from '../../../environments/environment';

// Actions
export type GardenAction =
  | { type: 'INIT' | 'LOAD_MEMORIES_START' | 'CLEAR_ERROR'; payload?: undefined }
  | { type: 'LOAD_MEMORIES_SUCCESS'; payload: MemoryData[] }
  | { type: 'LOAD_MEMORIES_ERROR' | 'SET_ERROR'; payload: string | null }
  | { type: 'ADD_MEMORY_OPTIMISTIC' | 'ADD_MEMORY_SUCCESS'; payload: MemoryData }
  | { type: 'UPDATE_MEMORY'; payload: { id: string; updates: Partial<MemoryData> } }
  | { type: 'DELETE_MEMORY'; payload: { id: string } }
  | { type: 'LOAD_INSIGHTS_SUCCESS'; payload: InsightData[] }
  | { type: 'ADD_INSIGHT'; payload: InsightData }
  | { type: 'UPDATE_ATMOSPHERE'; payload: AtmosphereData | null }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_PERFORMANCE_METRICS'; payload: Omit<PerformanceMetrics, 'lastMeasured'> };

export const GardenActions = {
  // Memory actions
  LOAD_MEMORIES_START: 'LOAD_MEMORIES_START',
  LOAD_MEMORIES_SUCCESS: 'LOAD_MEMORIES_SUCCESS',
  LOAD_MEMORIES_ERROR: 'LOAD_MEMORIES_ERROR',
  ADD_MEMORY_OPTIMISTIC: 'ADD_MEMORY_OPTIMISTIC',
  ADD_MEMORY_SUCCESS: 'ADD_MEMORY_SUCCESS',
  UPDATE_MEMORY: 'UPDATE_MEMORY',
  DELETE_MEMORY: 'DELETE_MEMORY',
  
  // Insight actions
  LOAD_INSIGHTS_SUCCESS: 'LOAD_INSIGHTS_SUCCESS',
  ADD_INSIGHT: 'ADD_INSIGHT',
  
  // Atmosphere actions
  UPDATE_ATMOSPHERE: 'UPDATE_ATMOSPHERE',
  
  // UI actions
  SET_LOADING: 'SET_LOADING',
  SET_ERROR: 'SET_ERROR',
  CLEAR_ERROR: 'CLEAR_ERROR',
  
  // Performance actions
  SET_PERFORMANCE_METRICS: 'SET_PERFORMANCE_METRICS'
} as const;

export interface PerformanceMetrics {
  renderTime: number;
  memoryUsage: number;
  apiResponseTime: number;
  lastMeasured: Date;
}

interface EmotionalTrend {
  average: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  count: number;
}

export interface GardenState {
  // Data
  memories: MemoryData[];
  insights: InsightData[];
  atmosphere: AtmosphereData | null;
  
  // Metadata
  totalPlants: number;
  lastUpdated: Date;
  
  // UI State
  isLoading: boolean;
  error: string | null;
  
  // Performance
  performance: PerformanceMetrics;
  
  // Feature flags
  features: {
    realTimeUpdates: boolean;
    advancedVisualizations: boolean;
    arMode: boolean;
    chatbot: boolean;
    poeticRephrasing: boolean;
  };
  
  // Cache
  cache: {
    lastAtmosphereUpdate: Date | null;
    lastInsightUpdate: Date | null;
  };
}

const initialState: GardenState = {
  memories: [],
  insights: [],
  atmosphere: null,
  totalPlants: 0,
  lastUpdated: new Date(),
  isLoading: false,
  error: null,
  performance: {
    renderTime: 0,
    memoryUsage: 0,
    apiResponseTime: 0,
    lastMeasured: new Date()
  },
  features: {
    realTimeUpdates: true,
    advancedVisualizations: true,
    arMode: true,
    chatbot: true,
    poeticRephrasing: true
  },
  cache: {
    lastAtmosphereUpdate: null,
    lastInsightUpdate: null
  }
};

@Injectable({
  providedIn: 'root'
})
export class GardenStateService {
  private stateSubject = new BehaviorSubject<GardenState>(initialState);
  private actionsSubject = new BehaviorSubject<GardenAction>({ type: 'INIT' });

  // State selectors
  public state$ = this.stateSubject.asObservable();
  public actions$ = this.actionsSubject.asObservable();
  
  // Specific selectors with memoization
  public memories$ = this.select(state => state.memories);
  public insights$ = this.select(state => state.insights);
  public atmosphere$ = this.select(state => state.atmosphere);
  public isLoading$ = this.select(state => state.isLoading);
  public error$ = this.select(state => state.error);
  public totalPlants$ = this.select(state => state.totalPlants);
  public performance$ = this.select(state => state.performance);
  public features$ = this.select(state => state.features);

  // Advanced selectors
  public recentMemories$ = this.select(state => 
    state.memories.slice(0, 10).sort((a, b) => b.timestamp - a.timestamp)
  );
  
  public emotionalTrends$ = this.select(state => 
    this.calculateEmotionalTrends(state.memories)
  );
  
  public performanceScore$ = this.select(state => 
    this.calculatePerformanceScore(state.performance)
  );

  constructor() {
    // Log all actions in development
    if (!environment.production) {
      this.actions$.subscribe(action => {
        console.log('🌱 Garden Action:', action);
      });
    }
  }

  // Dispatch action
  dispatch(action: GardenAction): void {
    const currentState = this.stateSubject.value;
    const newState = this.reduce(currentState, action);
    
    this.stateSubject.next(newState);
    this.actionsSubject.next(action);
  }

  // Get current state synchronously
  getState(): GardenState {
    return this.stateSubject.value;
  }

  // Select with memoization
  private select<T>(selector: (state: GardenState) => T): Observable<T> {
    return this.state$.pipe(
      map(selector),
      distinctUntilChanged(),
      shareReplay(1)
    );
  }

  // State reducer
  private reduce(state: GardenState, action: GardenAction): GardenState {
    switch (action.type) {
      case GardenActions.LOAD_MEMORIES_START:
        return {
          ...state,
          isLoading: true,
          error: null
        };

      case GardenActions.LOAD_MEMORIES_SUCCESS:
        return {
          ...state,
          memories: action.payload,
          totalPlants: action.payload.length,
          isLoading: false,
          error: null,
          lastUpdated: new Date()
        };

      case GardenActions.LOAD_MEMORIES_ERROR:
        return {
          ...state,
          isLoading: false,
          error: action.payload
        };

      case GardenActions.ADD_MEMORY_OPTIMISTIC:
        return {
          ...state,
          memories: [action.payload, ...state.memories],
          totalPlants: state.totalPlants + 1
        };

      case GardenActions.ADD_MEMORY_SUCCESS: {
        // Replace optimistic memory with real one
        const updatedMemories = state.memories.map(memory => 
          memory.timestamp === action.payload.timestamp ? action.payload : memory
        );
        return {
          ...state,
          memories: updatedMemories,
          lastUpdated: new Date()
        };
      }

      case GardenActions.UPDATE_MEMORY:
        return {
          ...state,
          memories: state.memories.map(memory => 
            memory.id === action.payload.id 
              ? { ...memory, ...action.payload.updates }
              : memory
          ),
          lastUpdated: new Date()
        };

      case GardenActions.DELETE_MEMORY:
        return {
          ...state,
          memories: state.memories.filter(memory => memory.id !== action.payload.id),
          totalPlants: Math.max(0, state.totalPlants - 1),
          lastUpdated: new Date()
        };

      case GardenActions.LOAD_INSIGHTS_SUCCESS:
        return {
          ...state,
          insights: action.payload,
          cache: {
            ...state.cache,
            lastInsightUpdate: new Date()
          }
        };

      case GardenActions.ADD_INSIGHT:
        return {
          ...state,
          insights: [action.payload, ...state.insights.slice(0, 9)], // Keep max 10
          cache: {
            ...state.cache,
            lastInsightUpdate: new Date()
          }
        };

      case GardenActions.UPDATE_ATMOSPHERE:
        return {
          ...state,
          atmosphere: action.payload,
          cache: {
            ...state.cache,
            lastAtmosphereUpdate: new Date()
          }
        };

      case GardenActions.SET_LOADING:
        return {
          ...state,
          isLoading: action.payload
        };

      case GardenActions.SET_ERROR:
        return {
          ...state,
          error: action.payload,
          isLoading: false
        };

      case GardenActions.CLEAR_ERROR:
        return {
          ...state,
          error: null
        };

      case GardenActions.SET_PERFORMANCE_METRICS:
        return {
          ...state,
          performance: {
            ...action.payload,
            lastMeasured: new Date()
          }
        };

      default:
        return state;
    }
  }

  // Helper methods
  private calculateEmotionalTrends(memories: MemoryData[]): Record<string, EmotionalTrend> {
    if (memories.length === 0) return {};
    
    const emotions = ['joy', 'sadness', 'anger', 'fear', 'surprise'];
    const trends: Record<string, EmotionalTrend> = {};
    
    emotions.forEach(emotion => {
      const emotionValues = memories
        .filter(m => m.emotions && m.emotions[emotion])
        .map(m => m.emotions[emotion]);
        
      if (emotionValues.length > 0) {
        trends[emotion] = {
          average: emotionValues.reduce((a, b) => a + b, 0) / emotionValues.length,
          trend: this.calculateTrend(emotionValues),
          count: emotionValues.length
        };
      }
    });
    
    return trends;
  }

  private calculateTrend(values: number[]): EmotionalTrend['trend'] {
    if (values.length < 2) return 'stable';
    
    const recent = values.slice(-5); // Last 5 values
    const older = values.slice(-10, -5); // Previous 5 values
    
    if (recent.length === 0 || older.length === 0) return 'stable';
    
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
    
    const threshold = 0.1;
    if (recentAvg > olderAvg + threshold) return 'increasing';
    if (recentAvg < olderAvg - threshold) return 'decreasing';
    return 'stable';
  }

  private calculatePerformanceScore(metrics: PerformanceMetrics): number {
    // Calculate score based on various metrics (0-100)
    let score = 100;
    
    // Render time penalty (>100ms is bad)
    if (metrics.renderTime > 100) {
      score -= Math.min(30, (metrics.renderTime - 100) / 10);
    }
    
    // Memory usage penalty (>50MB is concerning)
    if (metrics.memoryUsage > 50) {
      score -= Math.min(20, (metrics.memoryUsage - 50) / 5);
    }
    
    // API response time penalty (>1000ms is bad)
    if (metrics.apiResponseTime > 1000) {
      score -= Math.min(25, (metrics.apiResponseTime - 1000) / 100);
    }
    
    return Math.max(0, Math.round(score));
  }

  // Performance monitoring
  recordPerformanceMetric(type: keyof PerformanceMetrics, value: number): void {
    const currentMetrics = this.getState().performance;
    this.dispatch({
      type: GardenActions.SET_PERFORMANCE_METRICS,
      payload: {
        ...currentMetrics,
        [type]: value
      }
    });
  }

  // Feature flag management
  isFeatureEnabled(feature: keyof GardenState['features']): boolean {
    return this.getState().features[feature];
  }

  // Cache management
  shouldRefreshAtmosphere(): boolean {
    const { lastAtmosphereUpdate } = this.getState().cache;
    if (!lastAtmosphereUpdate) return true;
    
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    return lastAtmosphereUpdate < fiveMinutesAgo;
  }

  shouldRefreshInsights(): boolean {
    const { lastInsightUpdate } = this.getState().cache;
    if (!lastInsightUpdate) return true;
    
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    return lastInsightUpdate < tenMinutesAgo;
  }
}
