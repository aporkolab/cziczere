import { Component, OnInit, OnDestroy, ViewChild, ElementRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { WebSocketService } from '../services/websocket.service';
import { ApiService, MemoryData } from '../api.service';
import { Auth, user } from '@angular/fire/auth';
import { Subscription, BehaviorSubject } from 'rxjs';
import { trigger, transition, style, animate, query, stagger } from '@angular/animations';

export interface ChatMessage {
  id: string;
  content: string;
  sender: 'user' | 'assistant';
  timestamp: number;
  type: 'text' | 'insight' | 'suggestion' | 'memory_analysis';
  metadata?: Record<string, unknown>;
}

export interface ConversationContext {
  recentMemories: MemoryData[];
  currentMood: string;
  conversationHistory: ChatMessage[];
  userPreferences: Record<string, unknown>;
}

@Component({
  selector: 'app-chatbot',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './chatbot.component.html',
  styleUrls: ['./chatbot.component.css'],
  animations: [
    trigger('messageAnimation', [
      transition('* => *', [
        query(':enter', [
          style({ opacity: 0, transform: 'translateY(10px)' }),
          stagger(100, [
            animate('300ms ease-out', style({ opacity: 1, transform: 'translateY(0)' }))
          ])
        ], { optional: true })
      ])
    ]),
    trigger('typingIndicator', [
      transition(':enter', [
        style({ opacity: 0, scale: 0.8 }),
        animate('200ms ease-out', style({ opacity: 1, scale: 1 }))
      ]),
      transition(':leave', [
        animate('200ms ease-in', style({ opacity: 0, scale: 0.8 }))
      ])
    ])
  ]
})
export class ChatbotComponent implements OnInit, OnDestroy {
  @ViewChild('messagesContainer', { static: true }) messagesContainer!: ElementRef;
  @ViewChild('messageInput', { static: true }) messageInput!: ElementRef;

  private auth: Auth = inject(Auth);
  private wsService: WebSocketService = inject(WebSocketService);
  private apiService: ApiService = inject(ApiService);
  
  user$ = user(this.auth);
  private subscriptions: Subscription[] = [];
  
  // Chat state
  messages$ = new BehaviorSubject<ChatMessage[]>([]);
  isConnected$ = new BehaviorSubject<boolean>(false);
  isTyping$ = new BehaviorSubject<boolean>(false);
  conversationContext: ConversationContext = {
    recentMemories: [],
    currentMood: 'neutral',
    conversationHistory: [],
    userPreferences: {}
  };

  // Form
  messageForm = new FormGroup({
    message: new FormControl('', [Validators.required, Validators.minLength(1), Validators.maxLength(500)])
  });

  // UI State
  isChatMinimized = false;
  currentSuggestions: string[] = [];
  isInitialLoad = true;

  ngOnInit(): void {
    this.initializeChatbot();
    this.setupWebSocketConnection();
    this.loadConversationContext();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.wsService.disconnect();
  }

  private initializeChatbot(): void {
    // Welcome message
    const welcomeMessage: ChatMessage = {
      id: this.generateMessageId(),
      content: "Hello! I'm your Gardener's Assistant. I'm here to help you reflect on your memories and discover patterns in your thoughts. How are you feeling today?",
      sender: 'assistant',
      timestamp: Date.now(),
      type: 'text'
    };
    
    this.addMessage(welcomeMessage);
    this.isInitialLoad = false;

    // Load contextual suggestions
    this.generateContextualSuggestions();
  }

  private setupWebSocketConnection(): void {
    const connectionSub = this.wsService.connect().subscribe({
      next: (connected) => {
        this.isConnected$.next(connected);
        if (connected) {
          this.setupMessageListeners();
        }
      },
      error: (error) => {
        console.error('WebSocket connection error:', error);
        this.handleConnectionError();
      }
    });
    this.subscriptions.push(connectionSub);
  }

  private setupMessageListeners(): void {
    // Listen for assistant messages
    const messageSub = this.wsService.onMessage().subscribe((message: ChatMessage) => {
      this.addMessage(message);
      this.isTyping$.next(false);
      this.updateConversationContext(message);
    });

    // Listen for typing indicators
    const typingSub = this.wsService.onTyping().subscribe((isTyping: boolean) => {
      this.isTyping$.next(isTyping);
    });

    // Listen for suggestions
    const suggestionsSub = this.wsService.onSuggestions().subscribe((suggestions: string[]) => {
      this.currentSuggestions = suggestions;
    });

    this.subscriptions.push(messageSub, typingSub, suggestionsSub);
  }

  private loadConversationContext(): void {
    // Load recent memories for context
    const memoriesSub = this.apiService.getMemories().subscribe({
      next: (memories) => {
        this.conversationContext.recentMemories = memories
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, 10); // Last 10 memories
        
        this.analyzeUserMoodFromMemories();
      },
      error: (error) => console.error('Error loading memories context:', error)
    });
    this.subscriptions.push(memoriesSub);
  }

  private analyzeUserMoodFromMemories(): void {
    if (this.conversationContext.recentMemories.length === 0) return;

    const recentEmotions = this.conversationContext.recentMemories
      .flatMap(memory => Object.entries(memory.emotions))
      .reduce((acc, [emotion, score]) => {
        acc[emotion] = (acc[emotion] || 0) + score;
        return acc;
      }, {} as Record<string, number>);

    // Determine dominant mood
    const dominantMood = Object.entries(recentEmotions)
      .sort(([,a], [,b]) => b - a)[0];
    
    this.conversationContext.currentMood = dominantMood ? dominantMood[0] : 'neutral';
  }

  async sendMessage(): Promise<void> {
    if (this.messageForm.invalid || !this.messageForm.value.message?.trim()) return;

    const userMessage: ChatMessage = {
      id: this.generateMessageId(),
      content: this.messageForm.value.message!.trim(),
      sender: 'user',
      timestamp: Date.now(),
      type: 'text'
    };

    this.addMessage(userMessage);
    this.messageForm.reset();
    this.isTyping$.next(true);

    // Update conversation context
    this.conversationContext.conversationHistory.push(userMessage);

    // Send to WebSocket service
    try {
      await this.wsService.sendMessage(userMessage, this.conversationContext);
    } catch (error) {
      console.error('Error sending message:', error);
      this.handleMessageError();
    }
  }

  useSuggestion(suggestion: string): void {
    this.messageForm.patchValue({ message: suggestion });
    this.messageInput.nativeElement.focus();
  }

  private generateContextualSuggestions(): void {
    const baseSuggestions = [
      "How do I reflect better on my memories?",
      "What patterns do you see in my recent thoughts?",
      "I'm feeling overwhelmed today",
      "Can you help me find moments of joy?",
      "What should I focus on this week?"
    ];

    // Personalize based on context
    if (this.conversationContext.currentMood === 'sad') {
      this.currentSuggestions = [
        "I need some encouragement today",
        "Help me find positive memories",
        "What can lift my spirits?"
      ];
    } else if (this.conversationContext.currentMood === 'anxious') {
      this.currentSuggestions = [
        "I'm feeling anxious, can you help?",
        "What are some calming memories I have?",
        "How can I find peace today?"
      ];
    } else {
      this.currentSuggestions = baseSuggestions;
    }
  }

  private addMessage(message: ChatMessage): void {
    const currentMessages = this.messages$.value;
    this.messages$.next([...currentMessages, message]);
    setTimeout(() => this.scrollToBottom(), 100);
  }

  private updateConversationContext(message: ChatMessage): void {
    this.conversationContext.conversationHistory.push(message);
    
    // Keep only last 20 messages for context
    if (this.conversationContext.conversationHistory.length > 20) {
      this.conversationContext.conversationHistory = 
        this.conversationContext.conversationHistory.slice(-20);
    }

    // Update suggestions based on conversation
    this.generateContextualSuggestions();
  }

  private scrollToBottom(): void {
    try {
      const element = this.messagesContainer.nativeElement;
      element.scrollTop = element.scrollHeight;
    } catch (err) {
      console.error('Error scrolling to bottom:', err);
    }
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private handleConnectionError(): void {
    const errorMessage: ChatMessage = {
      id: this.generateMessageId(),
      content: "I'm having trouble connecting right now. I'll try to reconnect automatically.",
      sender: 'assistant',
      timestamp: Date.now(),
      type: 'text'
    };
    this.addMessage(errorMessage);
  }

  private handleMessageError(): void {
    this.isTyping$.next(false);
    const errorMessage: ChatMessage = {
      id: this.generateMessageId(),
      content: "I apologize, but I couldn't process your message right now. Please try again.",
      sender: 'assistant',
      timestamp: Date.now(),
      type: 'text'
    };
    this.addMessage(errorMessage);
  }

  toggleChatMinimized(): void {
    this.isChatMinimized = !this.isChatMinimized;
  }

  // Keyboard shortcuts
  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  // Advanced features
  requestMemoryAnalysis(): void {
    const analysisRequest: ChatMessage = {
      id: this.generateMessageId(),
      content: "analyze_recent_memories",
      sender: 'user',
      timestamp: Date.now(),
      type: 'memory_analysis'
    };
    
    this.wsService.sendMessage(analysisRequest, this.conversationContext);
  }

  exportConversation(): void {
    const conversation = this.messages$.value;
    const blob = new Blob([JSON.stringify(conversation, null, 2)], 
      { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `garden-conversation-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
