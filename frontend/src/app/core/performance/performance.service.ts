import { Injectable, inject, NgZone } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { GardenStateService } from '../state/garden-state.service';

export interface PerformanceEntry {
  name: string;
  entryType: string;
  startTime: number;
  duration: number;
  timestamp: Date;
}

export interface MemoryInfo {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

export interface NetworkMetrics {
  apiCallsTotal: number;
  apiCallsSuccessful: number;
  apiCallsFailed: number;
  averageResponseTime: number;
  slowestCall: {
    url: string;
    duration: number;
    timestamp: Date;
  } | null;
}

export interface RenderMetrics {
  fps: number;
  frameDrops: number;
  longTasks: number;
  renderTime: number;
}

export interface UserInteractionMetrics {
  clicksPerMinute: number;
  keystrokesPerMinute: number;
  scrollEventsPerMinute: number;
  lastInteraction: Date;
}

export interface PerformanceReport {
  memory: MemoryInfo | null;
  network: NetworkMetrics;
  rendering: RenderMetrics;
  userInteractions: UserInteractionMetrics;
  score: number;
  recommendations: string[];
  timestamp: Date;
}

@Injectable({
  providedIn: 'root'
})
export class PerformanceService {
  private gardenState = inject(GardenStateService);
  private ngZone = inject(NgZone);

  private performanceReportSubject = new BehaviorSubject<PerformanceReport | null>(null);
  public performanceReport$ = this.performanceReportSubject.asObservable();

  private networkMetrics: NetworkMetrics = {
    apiCallsTotal: 0,
    apiCallsSuccessful: 0,
    apiCallsFailed: 0,
    averageResponseTime: 0,
    slowestCall: null
  };

  private renderMetrics: RenderMetrics = {
    fps: 60,
    frameDrops: 0,
    longTasks: 0,
    renderTime: 0
  };

  private userInteractionMetrics: UserInteractionMetrics = {
    clicksPerMinute: 0,
    keystrokesPerMinute: 0,
    scrollEventsPerMinute: 0,
    lastInteraction: new Date()
  };

  private responseTimes: number[] = [];
  private frameTimestamps: number[] = [];
  private longTaskObserver?: PerformanceObserver;
  private resizeObserver?: ResizeObserver;
  
  // Interaction counters
  private interactionCounts = {
    clicks: 0,
    keystrokes: 0,
    scrolls: 0
  };
  
  private lastResetTime = Date.now();

  constructor() {
    if (environment.features.enablePerformanceMonitoring) {
      this.initializeMonitoring();
    }
  }

  private initializeMonitoring(): void {
    this.setupPerformanceObservers();
    this.setupUserInteractionTracking();
    this.setupNetworkMonitoring();
    this.setupRenderingMonitoring();
    
    // Generate reports every 30 seconds
    setInterval(() => this.generateReport(), 30000);
  }

  private setupPerformanceObservers(): void {
    if ('PerformanceObserver' in window) {
      // Long task observer
      this.longTaskObserver = new PerformanceObserver((list) => {
        this.renderMetrics.longTasks += list.getEntries().length;
      });
      
      try {
        this.longTaskObserver.observe({ entryTypes: ['longtask'] });
      } catch {
        console.warn('Long task observer not supported');
      }

      // Navigation and resource timing
      const perfObserver = new PerformanceObserver((list) => {
        list.getEntries().forEach(entry => {
          if (entry.entryType === 'navigation') {
            this.gardenState.recordPerformanceMetric('renderTime', entry.duration);
          }
        });
      });
      
      try {
        perfObserver.observe({ entryTypes: ['navigation', 'resource'] });
      } catch {
        console.warn('Performance observer not fully supported');
      }
    }
  }

  private setupUserInteractionTracking(): void {
    this.ngZone.runOutsideAngular(() => {
      // Click tracking
      document.addEventListener('click', () => {
        this.interactionCounts.clicks++;
        this.userInteractionMetrics.lastInteraction = new Date();
      }, { passive: true });

      // Keypress tracking
      document.addEventListener('keydown', () => {
        this.interactionCounts.keystrokes++;
        this.userInteractionMetrics.lastInteraction = new Date();
      }, { passive: true });

      // Scroll tracking
      document.addEventListener('scroll', () => {
        this.interactionCounts.scrolls++;
        this.userInteractionMetrics.lastInteraction = new Date();
      }, { passive: true });
    });
  }

  private setupNetworkMonitoring(): void {
    // Monkey patch fetch to monitor API calls
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const startTime = performance.now();
      this.networkMetrics.apiCallsTotal++;

      try {
        const response = await originalFetch(...args);
        const duration = performance.now() - startTime;
        
        this.trackApiCall(args[0]?.toString() || 'unknown', duration, response.ok);
        
        return response;
      } catch (error) {
        const duration = performance.now() - startTime;
        this.trackApiCall(args[0]?.toString() || 'unknown', duration, false);
        throw error;
      }
    };
  }

  private setupRenderingMonitoring(): void {
    let lastFrameTime = performance.now();
    let frameCount = 0;

    const measureFrame = () => {
      const currentFrameTime = performance.now();
      const frameDuration = currentFrameTime - lastFrameTime;
      
      frameCount++;
      this.frameTimestamps.push(currentFrameTime);

      // Keep only last 60 frames
      if (this.frameTimestamps.length > 60) {
        this.frameTimestamps.shift();
      }

      // Calculate FPS
      if (frameCount % 60 === 0) {
        this.calculateFPS();
      }

      // Detect frame drops (>16.67ms for 60fps)
      if (frameDuration > 16.67) {
        this.renderMetrics.frameDrops++;
      }

      lastFrameTime = currentFrameTime;
      requestAnimationFrame(measureFrame);
    };

    requestAnimationFrame(measureFrame);
  }

  private trackApiCall(url: string, duration: number, success: boolean): void {
    this.responseTimes.push(duration);
    
    if (success) {
      this.networkMetrics.apiCallsSuccessful++;
    } else {
      this.networkMetrics.apiCallsFailed++;
    }

    // Keep only last 100 response times
    if (this.responseTimes.length > 100) {
      this.responseTimes.shift();
    }

    // Update average
    this.networkMetrics.averageResponseTime = 
      this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length;

    // Track slowest call
    if (!this.networkMetrics.slowestCall || duration > this.networkMetrics.slowestCall.duration) {
      this.networkMetrics.slowestCall = {
        url,
        duration,
        timestamp: new Date()
      };
    }

    // Report to state service
    this.gardenState.recordPerformanceMetric('apiResponseTime', duration);
  }

  private calculateFPS(): void {
    if (this.frameTimestamps.length < 2) return;

    const timeSpan = this.frameTimestamps[this.frameTimestamps.length - 1] - this.frameTimestamps[0];
    this.renderMetrics.fps = Math.round((this.frameTimestamps.length - 1) * 1000 / timeSpan);
  }

  private calculateInteractionRates(): void {
    const now = Date.now();
    const timeDiff = (now - this.lastResetTime) / 60000; // Convert to minutes

    this.userInteractionMetrics.clicksPerMinute = this.interactionCounts.clicks / timeDiff;
    this.userInteractionMetrics.keystrokesPerMinute = this.interactionCounts.keystrokes / timeDiff;
    this.userInteractionMetrics.scrollEventsPerMinute = this.interactionCounts.scrolls / timeDiff;

    // Reset counters every 10 minutes
    if (timeDiff > 10) {
      this.interactionCounts = { clicks: 0, keystrokes: 0, scrolls: 0 };
      this.lastResetTime = now;
    }
  }

  private getMemoryInfo(): MemoryInfo | null {
    if ('memory' in performance) {
      const memory = performance.memory as MemoryInfo;
      return {
        usedJSHeapSize: memory.usedJSHeapSize,
        totalJSHeapSize: memory.totalJSHeapSize,
        jsHeapSizeLimit: memory.jsHeapSizeLimit
      };
    }
    return null;
  }

  private generateRecommendations(report: PerformanceReport): string[] {
    const recommendations: string[] = [];

    if (report.rendering.fps < 30) {
      recommendations.push('Low FPS detected. Consider reducing visual complexity or enabling performance mode.');
    }

    if (report.rendering.longTasks > 5) {
      recommendations.push('Multiple long tasks detected. Consider breaking up expensive operations.');
    }

    if (report.network.averageResponseTime > 2000) {
      recommendations.push('Slow API responses detected. Check network connection or API performance.');
    }

    if (report.memory && report.memory.usedJSHeapSize > 100 * 1024 * 1024) {
      recommendations.push('High memory usage detected. Consider implementing memory cleanup strategies.');
    }

    if (report.network.apiCallsFailed > report.network.apiCallsSuccessful * 0.1) {
      recommendations.push('High API failure rate detected. Check error handling and retry logic.');
    }

    return recommendations;
  }

  private calculatePerformanceScore(report: PerformanceReport): number {
    let score = 100;

    // FPS penalty
    if (report.rendering.fps < 60) {
      score -= (60 - report.rendering.fps) * 0.5;
    }

    // Long tasks penalty
    score -= report.rendering.longTasks * 2;

    // Network penalty
    if (report.network.averageResponseTime > 1000) {
      score -= (report.network.averageResponseTime - 1000) / 100;
    }

    // Memory penalty
    if (report.memory && report.memory.usedJSHeapSize > 50 * 1024 * 1024) {
      score -= (report.memory.usedJSHeapSize - 50 * 1024 * 1024) / (10 * 1024 * 1024);
    }

    // API failure penalty
    const failureRate = report.network.apiCallsFailed / Math.max(1, report.network.apiCallsTotal);
    score -= failureRate * 20;

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  private generateReport(): void {
    this.calculateInteractionRates();

    const report: PerformanceReport = {
      memory: this.getMemoryInfo(),
      network: { ...this.networkMetrics },
      rendering: { ...this.renderMetrics },
      userInteractions: { ...this.userInteractionMetrics },
      score: 0,
      recommendations: [],
      timestamp: new Date()
    };

    report.score = this.calculatePerformanceScore(report);
    report.recommendations = this.generateRecommendations(report);

    this.performanceReportSubject.next(report);

    // Update memory usage in garden state
    if (report.memory) {
      this.gardenState.recordPerformanceMetric(
        'memoryUsage', 
        report.memory.usedJSHeapSize / (1024 * 1024) // Convert to MB
      );
    }
  }

  // Public methods
  public getCurrentReport(): PerformanceReport | null {
    return this.performanceReportSubject.value;
  }

  public measureCustomOperation<T>(name: string, operation: () => T): T {
    const startTime = performance.now();
    const result = operation();
    const duration = performance.now() - startTime;

    console.log(`🔍 Performance: ${name} took ${duration.toFixed(2)}ms`);
    
    return result;
  }

  public measureAsyncOperation<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const startTime = performance.now();
    
    return operation().then(result => {
      const duration = performance.now() - startTime;
      console.log(`🔍 Performance: ${name} took ${duration.toFixed(2)}ms`);
      return result;
    });
  }

  public markUserAction(action: string): void {
    if ('performance' in window && 'mark' in performance) {
      performance.mark(`user-action-${action}-${Date.now()}`);
    }
  }

  public startProfile(name: string): void {
    if ('performance' in window && 'mark' in performance) {
      performance.mark(`${name}-start`);
    }
  }

  public endProfile(name: string): number {
    if ('performance' in window && 'mark' in performance) {
      performance.mark(`${name}-end`);
      
      if ('measure' in performance) {
        performance.measure(name, `${name}-start`, `${name}-end`);
        
        const measures = performance.getEntriesByName(name);
        if (measures.length > 0) {
          const duration = measures[measures.length - 1].duration;
          console.log(`🔍 Profile: ${name} took ${duration.toFixed(2)}ms`);
          return duration;
        }
      }
    }
    return 0;
  }

  public getNetworkMetrics(): NetworkMetrics {
    return { ...this.networkMetrics };
  }

  public getRenderMetrics(): RenderMetrics {
    return { ...this.renderMetrics };
  }

  public getUserInteractionMetrics(): UserInteractionMetrics {
    return { ...this.userInteractionMetrics };
  }

  // Cleanup method
  public destroy(): void {
    if (this.longTaskObserver) {
      this.longTaskObserver.disconnect();
    }
    
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
  }
}
