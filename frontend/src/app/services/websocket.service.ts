import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, Subject, interval, timer } from 'rxjs';
import { WebSocketSubject, webSocket } from 'rxjs/webSocket';
import { takeUntil, retry, catchError } from 'rxjs/operators';
import { Auth, idToken } from '@angular/fire/auth';
import { environment } from '../../environments/environment';
import type { ChatMessage, ConversationContext } from '../chatbot/chatbot.component';

export type WebSocketMessage = {
  timestamp: number;
  messageId?: string;
  userId?: string;
  token?: string | null;
} & (
  | { type: 'message'; payload: ChatMessage | { message: ChatMessage; context: Omit<ConversationContext, 'userPreferences'> } }
  | { type: 'typing'; payload: { isTyping: boolean; userId?: string } }
  | { type: 'suggestions'; payload: { suggestions: string[] } | { action: 'request'; context: { currentMood: string; recentTopics: string[] } } }
  | { type: 'system'; payload: { message: string } | { action: 'sync_history'; messages: ChatMessage[] } }
  | { type: 'heartbeat'; payload: { timestamp: number } }
);

interface WebSocketConfig {
  url: string;
  protocols?: string[];
  reconnectInterval: number;
  maxReconnectAttempts: number;
  heartbeatInterval: number;
  messageTimeout: number;
}

@Injectable({
  providedIn: 'root'
})
export class WebSocketService {
  private auth: Auth = inject(Auth);
  
  // WebSocket configuration
  private config: WebSocketConfig = {
    url: environment.production 
      ? `wss://${environment.firebase.projectId}.cloudfunctions.net/chatWebSocket`
      : 'ws://localhost:8080/chat',
    reconnectInterval: 3000,
    maxReconnectAttempts: 10,
    heartbeatInterval: 30000,
    messageTimeout: 30000
  };

  // Connection state
  private socket$: WebSocketSubject<WebSocketMessage> | null = null;
  private destroy$ = new Subject<void>();
  private reconnectAttempts = 0;
  private isConnected$ = new BehaviorSubject<boolean>(false);
  private connectionError$ = new Subject<Error>();

  // Message streams
  private incomingMessages$ = new Subject<ChatMessage>();
  private typingIndicator$ = new Subject<boolean>();
  private suggestions$ = new Subject<string[]>();
  private systemMessages$ = new Subject<string>();

  // Heartbeat and connection management
  private heartbeatTimer$ = new Subject<void>();
  private lastHeartbeat = 0;
  private pendingMessages = new Map<string, { message: WebSocketMessage; timestamp: number }>();

  constructor() {
    this.initializeHeartbeat();
    this.setupConnectionErrorHandling();
  }

  /**
   * Establish WebSocket connection with authentication
   */
  connect(): Observable<boolean> {
    return new Observable(observer => {
      // Get authentication token first
      idToken(this.auth).subscribe({
        next: (token) => {
          if (!token) {
            observer.error(new Error('No authentication token available'));
            return;
          }

          this.establishConnection(token);
          
          // Subscribe to connection status
          const connectionSub = this.isConnected$.subscribe(connected => {
            observer.next(connected);
            if (!connected && this.reconnectAttempts >= this.config.maxReconnectAttempts) {
              observer.error(new Error('Max reconnection attempts exceeded'));
            }
          });

          // Cleanup function
          return () => {
            connectionSub.unsubscribe();
          };
        },
        error: (error) => {
          observer.error(error);
        }
      });
    });
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    this.destroy$.next();
    this.destroy$.complete();
    
    if (this.socket$) {
      this.socket$.complete();
      this.socket$ = null;
    }
    
    this.isConnected$.next(false);
    this.reconnectAttempts = 0;
  }

  /**
   * Send message through WebSocket
   */
  async sendMessage(message: ChatMessage, context: ConversationContext): Promise<void> {
    if (!this.socket$ || !this.isConnected$.value) {
      throw new Error('WebSocket not connected');
    }

    const token = await idToken(this.auth).toPromise();
    const wsMessage: WebSocketMessage = {
      type: 'message',
      payload: {
        message,
        context: {
          recentMemories: context.recentMemories.slice(0, 5), // Limit for bandwidth
          currentMood: context.currentMood,
          conversationHistory: context.conversationHistory.slice(-10) // Last 10 messages
        }
      },
      timestamp: Date.now(),
      messageId: this.generateMessageId(),
      userId: this.auth.currentUser?.uid,
      token
    };

    // Add to pending messages for reliability
    this.pendingMessages.set(wsMessage.messageId!, {
      message: wsMessage,
      timestamp: Date.now()
    });

    try {
      this.socket$.next(wsMessage);
      this.cleanupPendingMessages();
    } catch (error) {
      this.pendingMessages.delete(wsMessage.messageId!);
      throw error;
    }
  }

  /**
   * Listen for incoming messages
   */
  onMessage(): Observable<ChatMessage> {
    return this.incomingMessages$.asObservable();
  }

  /**
   * Listen for typing indicators
   */
  onTyping(): Observable<boolean> {
    return this.typingIndicator$.asObservable();
  }

  /**
   * Listen for conversation suggestions
   */
  onSuggestions(): Observable<string[]> {
    return this.suggestions$.asObservable();
  }

  /**
   * Listen for system messages
   */
  onSystemMessage(): Observable<string> {
    return this.systemMessages$.asObservable();
  }

  /**
   * Get connection status
   */
  getConnectionStatus(): Observable<boolean> {
    return this.isConnected$.asObservable();
  }

  /**
   * Get connection errors
   */
  getConnectionError(): Observable<Error> {
    return this.connectionError$.asObservable();
  }

  private establishConnection(authToken: string): void {
    // Create WebSocket connection with authentication
    const wsUrl = `${this.config.url}?token=${encodeURIComponent(authToken)}`;
    
    this.socket$ = webSocket<WebSocketMessage>({
      url: wsUrl,
      protocol: this.config.protocols,
      openObserver: {
        next: () => {
          console.log('✅ WebSocket connected successfully');
          this.isConnected$.next(true);
          this.reconnectAttempts = 0;
          this.sendHeartbeat();
        }
      },
      closeObserver: {
        next: (closeEvent) => {
          console.log('🔌 WebSocket disconnected:', closeEvent);
          this.isConnected$.next(false);
          this.handleReconnection();
        }
      }
    });

    // Handle incoming messages
    this.socket$.pipe(
      takeUntil(this.destroy$),
      retry({
        count: this.config.maxReconnectAttempts,
        delay: this.config.reconnectInterval
      }),
      catchError((error) => {
        console.error('WebSocket error:', error);
        this.connectionError$.next(error);
        this.isConnected$.next(false);
        return [];
      })
    ).subscribe({
      next: (wsMessage) => this.handleIncomingMessage(wsMessage),
      error: (error) => {
        console.error('WebSocket stream error:', error);
        this.connectionError$.next(error);
        this.handleReconnection();
      }
    });
  }

  private handleIncomingMessage(wsMessage: WebSocketMessage): void {
    const { type, payload } = wsMessage;
    switch (type) {
      case 'message':
        if ('sender' in payload) {
          this.incomingMessages$.next(payload);
        }
        break;

      case 'typing':
        this.typingIndicator$.next(payload.isTyping);
        break;

      case 'suggestions':
        if ('suggestions' in payload) {
          this.suggestions$.next(payload.suggestions);
        }
        break;

      case 'system':
        if ('message' in payload) {
          this.systemMessages$.next(payload.message);
        }
        break;

      case 'heartbeat':
        this.lastHeartbeat = Date.now();
        break;

      default:
        console.warn('Unknown WebSocket message type:', type);
    }
  }

  private handleReconnection(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error('❌ Max reconnection attempts exceeded');
      this.connectionError$.next(new Error('Max reconnection attempts exceeded'));
      return;
    }

    this.reconnectAttempts++;
    console.log(`🔄 Attempting to reconnect... (${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`);

    timer(this.config.reconnectInterval).pipe(
      takeUntil(this.destroy$)
    ).subscribe(() => {
      idToken(this.auth).subscribe(token => {
        if (token) {
          this.establishConnection(token);
        }
      });
    });
  }

  private initializeHeartbeat(): void {
    interval(this.config.heartbeatInterval).pipe(
      takeUntil(this.destroy$)
    ).subscribe(() => {
      if (this.isConnected$.value) {
        this.sendHeartbeat();
      }

      // Check if we've missed heartbeats (connection might be stale)
      if (Date.now() - this.lastHeartbeat > this.config.heartbeatInterval * 2) {
        console.warn('⚠️ Heartbeat timeout, forcing reconnection');
        this.isConnected$.next(false);
        this.handleReconnection();
      }
    });
  }

  private sendHeartbeat(): void {
    if (!this.socket$) return;

    const heartbeatMessage: WebSocketMessage = {
      type: 'heartbeat',
      payload: { timestamp: Date.now() },
      timestamp: Date.now(),
      userId: this.auth.currentUser?.uid
    };

    try {
      this.socket$.next(heartbeatMessage);
    } catch (error) {
      console.error('Failed to send heartbeat:', error);
    }
  }

  private cleanupPendingMessages(): void {
    const now = Date.now();
    for (const [id, pending] of this.pendingMessages.entries()) {
      if (now - pending.timestamp > this.config.messageTimeout) {
        this.pendingMessages.delete(id);
        console.warn(`Message ${id} timed out`);
      }
    }
  }

  private setupConnectionErrorHandling(): void {
    this.connectionError$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(error => {
      console.error('WebSocket connection error:', error);
      
      // Emit system message for UI
      this.systemMessages$.next('Connection lost. Attempting to reconnect...');
    });
  }

  private generateMessageId(): string {
    return `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Advanced features for senior-level implementation

  /**
   * Send typing indicator
   */
  sendTyping(isTyping: boolean): void {
    if (!this.socket$ || !this.isConnected$.value) return;

    const typingMessage: WebSocketMessage = {
      type: 'typing',
      payload: { isTyping, userId: this.auth.currentUser?.uid },
      timestamp: Date.now()
    };

    this.socket$.next(typingMessage);
  }

  /**
   * Request conversation suggestions based on context
   */
  requestSuggestions(context: ConversationContext): void {
    if (!this.socket$ || !this.isConnected$.value) return;

    const suggestionRequest: WebSocketMessage = {
      type: 'suggestions',
      payload: { 
        action: 'request',
        context: {
          currentMood: context.currentMood,
          recentTopics: this.extractTopicsFromHistory(context.conversationHistory)
        }
      },
      timestamp: Date.now()
    };

    this.socket$.next(suggestionRequest);
  }

  /**
   * Send batch of messages (for message history sync)
   */
  syncMessageHistory(messages: ChatMessage[]): void {
    if (!this.socket$ || !this.isConnected$.value) return;

    const syncMessage: WebSocketMessage = {
      type: 'system',
      payload: { 
        action: 'sync_history',
        messages: messages.slice(-20) // Last 20 messages
      },
      timestamp: Date.now()
    };

    this.socket$.next(syncMessage);
  }

  private extractTopicsFromHistory(history: ChatMessage[]): string[] {
    // Simple keyword extraction for context
    const allText = history
      .filter(msg => msg.type === 'text')
      .map(msg => msg.content)
      .join(' ');

    const commonWords = ['memory', 'feeling', 'garden', 'reflect', 'mood', 'thought'];
    return commonWords.filter(word => 
      allText.toLowerCase().includes(word.toLowerCase())
    );
  }

  /**
   * Get connection quality metrics
   */
  getConnectionMetrics(): {
    reconnectAttempts: number;
    lastHeartbeat: number;
    pendingMessages: number;
    isConnected: boolean;
  } {
    return {
      reconnectAttempts: this.reconnectAttempts,
      lastHeartbeat: this.lastHeartbeat,
      pendingMessages: this.pendingMessages.size,
      isConnected: this.isConnected$.value
    };
  }
}
