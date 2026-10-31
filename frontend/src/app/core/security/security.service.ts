import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent } from '@angular/common/http';
import { Observable, BehaviorSubject, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

export interface SecurityConfig {
  enableCSPHeaders: boolean;
  enableRateLimiting: boolean;
  enableXSSProtection: boolean;
  enableContentTypeNoSniff: boolean;
  enableFrameOptions: boolean;
  enableHSTS: boolean;
  maxRequestsPerMinute: number;
  maxRequestsPerHour: number;
  allowedOrigins: string[];
  trustedDomains: string[];
}

export interface RateLimitInfo {
  requests: number;
  resetTime: number;
  windowStart: number;
}

export interface SecurityViolation {
  type: 'rate_limit' | 'csp_violation' | 'xss_attempt' | 'unauthorized_origin';
  severity: 'low' | 'medium' | 'high' | 'critical';
  details: Record<string, string | number>;
  timestamp: Date;
  userId?: string;
  ip?: string;
}

@Injectable({
  providedIn: 'root'
})
export class SecurityService implements HttpInterceptor {
  private config: SecurityConfig = {
    enableCSPHeaders: environment.production,
    enableRateLimiting: environment.features.enableRateLimiting,
    enableXSSProtection: true,
    enableContentTypeNoSniff: true,
    enableFrameOptions: true,
    enableHSTS: environment.production,
    maxRequestsPerMinute: 60,
    maxRequestsPerHour: 1000,
    allowedOrigins: environment.production 
      ? ['https://cziczere-ai.web.app', 'https://cziczere-ai.firebaseapp.com']
      : ['http://localhost:4200', 'http://127.0.0.1:4200'],
    trustedDomains: [
      'googleapis.com',
      'firebase.com',
      'firebaseapp.com',
      'cloudfunctions.net'
    ]
  };

  private rateLimitData = new Map<string, RateLimitInfo>();
  private securityViolationsSubject = new BehaviorSubject<SecurityViolation[]>([]);
  public securityViolations$ = this.securityViolationsSubject.asObservable();

  private blockedIPs = new Set<string>();
  private suspiciousActivities = new Map<string, number>();

  constructor() {
    this.initializeSecurity();
  }

  private initializeSecurity(): void {
    this.setupCSPViolationHandler();
    this.setupSecurityHeaders();
    this.setupInputSanitization();
    
    // Clean up rate limit data every 5 minutes
    setInterval(() => this.cleanupRateLimitData(), 5 * 60 * 1000);
    
    // Clean up suspicious activities every hour
    setInterval(() => this.cleanupSuspiciousActivities(), 60 * 60 * 1000);
  }

  private setupCSPViolationHandler(): void {
    if (this.config.enableCSPHeaders) {
      document.addEventListener('securitypolicyviolation', (event) => {
        this.recordSecurityViolation({
          type: 'csp_violation',
          severity: 'high',
          details: {
            violatedDirective: event.violatedDirective,
            blockedURI: event.blockedURI,
            sourceFile: event.sourceFile,
            lineNumber: event.lineNumber
          },
          timestamp: new Date()
        });
      });
    }
  }

  private setupSecurityHeaders(): void {
    if (!environment.production) return;

    // Add security headers via meta tags (backup for server-side headers)
    const head = document.getElementsByTagName('head')[0];

    if (this.config.enableXSSProtection) {
      const xssProtection = document.createElement('meta');
      xssProtection.httpEquiv = 'X-XSS-Protection';
      xssProtection.content = '1; mode=block';
      head.appendChild(xssProtection);
    }

    if (this.config.enableContentTypeNoSniff) {
      const noSniff = document.createElement('meta');
      noSniff.httpEquiv = 'X-Content-Type-Options';
      noSniff.content = 'nosniff';
      head.appendChild(noSniff);
    }

    if (this.config.enableFrameOptions) {
      const frameOptions = document.createElement('meta');
      frameOptions.httpEquiv = 'X-Frame-Options';
      frameOptions.content = 'DENY';
      head.appendChild(frameOptions);
    }
  }

  private setupInputSanitization(): void {
    // Monitor for potential XSS attempts
    const originalSetAttribute = Element.prototype.setAttribute;
    const detectXSSAttempt = this.detectXSSAttempt.bind(this);
    const recordViolation = this.recordSecurityViolation.bind(this);
    Element.prototype.setAttribute = function(name: string, value: string) {
      if (detectXSSAttempt(name, value)) {
        recordViolation({
          type: 'xss_attempt',
          severity: 'critical',
          details: { attribute: name, value },
          timestamp: new Date()
        });
        return;
      }
      originalSetAttribute.call(this, name, value);
    };
  }

  private detectXSSAttempt(name: string, value: string): boolean {
    const dangerousPatterns = [
      /<script[^>]*>.*?<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi,
      /<iframe[^>]*>/gi,
      /eval\s*\(/gi,
      /expression\s*\(/gi
    ];

    return dangerousPatterns.some(pattern => 
      pattern.test(name) || pattern.test(value)
    );
  }

  // HTTP Interceptor implementation
  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    const clientIP = this.getClientIP();
    
    // Check if IP is blocked
    if (this.blockedIPs.has(clientIP)) {
      return throwError(() => new Error('Access denied'));
    }

    // Rate limiting check
    if (this.config.enableRateLimiting && !this.checkRateLimit(clientIP)) {
      this.recordSecurityViolation({
        type: 'rate_limit',
        severity: 'medium',
        details: { ip: clientIP, endpoint: req.url },
        timestamp: new Date(),
        ip: clientIP
      });
      
      return throwError(() => new Error('Rate limit exceeded'));
    }

    // Origin validation
    const origin = req.headers.get('Origin') || window.location.origin;
    if (!this.isOriginAllowed(origin)) {
      this.recordSecurityViolation({
        type: 'unauthorized_origin',
        severity: 'high',
        details: { origin, endpoint: req.url },
        timestamp: new Date()
      });
      
      return throwError(() => new Error('Unauthorized origin'));
    }

    // Add security headers to request
    const secureReq = this.addSecurityHeaders(req);

    return next.handle(secureReq).pipe(
      tap(() => {
        // Record successful request
        this.updateRateLimit(clientIP);
      }),
      catchError(error => {
        // Track failed requests for suspicious activity detection
        this.trackFailedRequest(clientIP);
        return throwError(() => error);
      })
    );
  }

  private checkRateLimit(clientIP: string): boolean {
    const now = Date.now();
    const minuteWindow = 60 * 1000; // 1 minute
    const hourWindow = 60 * 60 * 1000; // 1 hour

    const rateLimitKey = `${clientIP}_minute`;
    const hourlyKey = `${clientIP}_hour`;

    // Check minute limit
    const minuteData = this.rateLimitData.get(rateLimitKey);
    if (minuteData) {
      if (now - minuteData.windowStart < minuteWindow) {
        if (minuteData.requests >= this.config.maxRequestsPerMinute) {
          return false;
        }
      } else {
        // Reset window
        this.rateLimitData.set(rateLimitKey, {
          requests: 0,
          resetTime: now + minuteWindow,
          windowStart: now
        });
      }
    } else {
      this.rateLimitData.set(rateLimitKey, {
        requests: 0,
        resetTime: now + minuteWindow,
        windowStart: now
      });
    }

    // Check hourly limit
    const hourlyData = this.rateLimitData.get(hourlyKey);
    if (hourlyData) {
      if (now - hourlyData.windowStart < hourWindow) {
        if (hourlyData.requests >= this.config.maxRequestsPerHour) {
          return false;
        }
      } else {
        // Reset window
        this.rateLimitData.set(hourlyKey, {
          requests: 0,
          resetTime: now + hourWindow,
          windowStart: now
        });
      }
    } else {
      this.rateLimitData.set(hourlyKey, {
        requests: 0,
        resetTime: now + hourWindow,
        windowStart: now
      });
    }

    return true;
  }

  private updateRateLimit(clientIP: string): void {
    const minuteKey = `${clientIP}_minute`;
    const hourlyKey = `${clientIP}_hour`;

    // Update minute counter
    const minuteData = this.rateLimitData.get(minuteKey);
    if (minuteData) {
      minuteData.requests++;
    }

    // Update hourly counter
    const hourlyData = this.rateLimitData.get(hourlyKey);
    if (hourlyData) {
      hourlyData.requests++;
    }
  }

  private isOriginAllowed(origin: string): boolean {
    if (!origin) return false;
    return this.config.allowedOrigins.some(allowed => 
      origin === allowed || origin.endsWith(allowed)
    );
  }

  private addSecurityHeaders(req: HttpRequest<unknown>): HttpRequest<unknown> {
    let headers = req.headers;

    // Add CSRF token if available
    const csrfToken = this.getCSRFToken();
    if (csrfToken) {
      headers = headers.set('X-CSRF-Token', csrfToken);
    }

    // Add request ID for tracing
    const requestId = this.generateRequestId();
    headers = headers.set('X-Request-ID', requestId);

    // Add security headers
    headers = headers.set('X-Requested-With', 'XMLHttpRequest');

    return req.clone({ headers });
  }

  private trackFailedRequest(clientIP: string): void {
    const key = `${clientIP}_failed`;
    const current = this.suspiciousActivities.get(key) || 0;
    this.suspiciousActivities.set(key, current + 1);

    // Block IP if too many failed requests
    if (current + 1 > 10) {
      this.blockedIPs.add(clientIP);
      console.warn(`🚨 Blocked IP ${clientIP} due to suspicious activity`);
    }
  }

  private cleanupRateLimitData(): void {
    const now = Date.now();
    for (const [key, data] of this.rateLimitData.entries()) {
      if (now > data.resetTime) {
        this.rateLimitData.delete(key);
      }
    }
  }

  private cleanupSuspiciousActivities(): void {
    // Reset suspicious activity counters every hour
    this.suspiciousActivities.clear();
  }

  private getClientIP(): string {
    // In a real application, this would be set by the server
    // For demo purposes, use a placeholder
    return 'client_ip';
  }

  private getCSRFToken(): string | null {
    // Get CSRF token from meta tag or localStorage
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : null;
  }

  private generateRequestId(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  private recordSecurityViolation(violation: SecurityViolation): void {
    const violations = this.securityViolationsSubject.value;
    const updatedViolations = [violation, ...violations.slice(0, 99)]; // Keep last 100
    this.securityViolationsSubject.next(updatedViolations);

    // Log critical violations
    if (violation.severity === 'critical' || violation.severity === 'high') {
      console.error('🚨 Security Violation:', violation);
    }

    // Send to monitoring service in production
    if (environment.production) {
      this.reportViolationToMonitoring(violation);
    }
  }

  private reportViolationToMonitoring(violation: SecurityViolation): void {
    // Report to external monitoring service
    fetch('/api/security/violation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(violation)
    }).catch(error => {
      console.error('Failed to report security violation:', error);
    });
  }

  // Public API
  public sanitizeInput(input: string): string {
    // Basic HTML sanitization
    return input
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  public isUrlSafe(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      const domain = parsedUrl.hostname;
      
      // Check against trusted domains
      return this.config.trustedDomains.some(trusted => 
        domain === trusted || domain.endsWith(`.${trusted}`)
      ) || this.config.allowedOrigins.includes(parsedUrl.origin);
    } catch {
      return false;
    }
  }

  public validateFileUpload(file: File): { valid: boolean; reason?: string } {
    // File type validation
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/json'];
    if (!allowedTypes.includes(file.type)) {
      return { valid: false, reason: 'File type not allowed' };
    }

    // File size validation (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      return { valid: false, reason: 'File too large' };
    }

    // File name validation
    if (this.detectXSSAttempt('filename', file.name)) {
      return { valid: false, reason: 'Suspicious file name' };
    }

    return { valid: true };
  }

  public getSecurityReport(): {
    blockedIPs: number;
    rateLimitViolations: number;
    xssAttempts: number;
    cspViolations: number;
  } {
    const violations = this.securityViolationsSubject.value;
    
    return {
      blockedIPs: this.blockedIPs.size,
      rateLimitViolations: violations.filter(v => v.type === 'rate_limit').length,
      xssAttempts: violations.filter(v => v.type === 'xss_attempt').length,
      cspViolations: violations.filter(v => v.type === 'csp_violation').length
    };
  }

  public unblockIP(ip: string): void {
    this.blockedIPs.delete(ip);
    this.suspiciousActivities.delete(`${ip}_failed`);
  }

  public updateSecurityConfig(config: Partial<SecurityConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
