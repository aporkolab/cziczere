package com.cziczere.functions;

import com.google.cloud.functions.HttpFunction;
import com.google.cloud.functions.HttpRequest;
import com.google.cloud.functions.HttpResponse;
import com.google.cloud.vertexai.VertexAI;
import com.google.cloud.vertexai.api.GenerateContentResponse;
import com.google.cloud.vertexai.generativeai.GenerativeModel;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseAuthException;
import com.google.firebase.auth.FirebaseToken;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.BufferedWriter;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Enterprise-grade WebSocket Cloud Function for real-time chat
 * Implements the Gardener's Assistant conversational AI with WebSocket support
 */
public class ChatWebSocketFunction implements HttpFunction {

    private static final Logger logger = Logger.getLogger(ChatWebSocketFunction.class.getName());
    private static final Gson gson = new Gson();
    
    // Configuration
    private static final int MAX_CONVERSATION_HISTORY = 20;
    private static final int MAX_CONCURRENT_SESSIONS = 1000;
    
    // Services
    private final VertexAI vertexAI;
    private final FirebaseAuth firebaseAuth;
    private final ExecutorService executorService;
    
    // Connection management
    private static final Map<String, ChatSession> activeSessions = new ConcurrentHashMap<>();
    private static final Map<String, Long> sessionHeartbeats = new ConcurrentHashMap<>();
    
    // Data models
    public static class WebSocketMessage {
        public String type;
        public Object payload;
        public long timestamp;
        public String messageId;
        public String userId;
        public String token;
    }
    
    public static class ChatMessage {
        public String id;
        public String content;
        public String sender;
        public long timestamp;
        public String type;
        public Map<String, Object> metadata;
    }
    
    public static class ConversationContext {
        public List<MemoryData> recentMemories;
        public String currentMood;
        public List<ChatMessage> conversationHistory;
        public Map<String, Object> userPreferences;
    }
    
    public static class ChatSession {
        public String userId;
        public String sessionId;
        public ConversationContext context;
        public List<ChatMessage> messageHistory;
        public long lastActivity;
        public boolean isTyping;
        
        public ChatSession(String userId, String sessionId) {
            this.userId = userId;
            this.sessionId = sessionId;
            this.context = new ConversationContext();
            this.context.conversationHistory = new ArrayList<>();
            this.messageHistory = new ArrayList<>();
            this.lastActivity = System.currentTimeMillis();
        }
    }

    static {
        FunctionSupport.initFirebase();
    }

    public ChatWebSocketFunction() throws IOException {
        this.vertexAI = FunctionSupport.vertexAI();
        this.firebaseAuth = FirebaseAuth.getInstance();
        this.executorService = Executors.newFixedThreadPool(10);
        
        // Initialize session cleanup
        initializeSessionCleanup();
    }

    @Override
    public void service(HttpRequest request, HttpResponse response) throws Exception {
        // CORS headers for WebSocket upgrade
        response.appendHeader("Access-Control-Allow-Origin", "*");
        response.appendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        response.appendHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Upgrade, Connection");

        if ("OPTIONS".equals(request.getMethod())) {
            response.setStatusCode(200);
            return;
        }

        try (BufferedWriter writer = response.getWriter()) {
            try {
                // Check if this is a WebSocket upgrade request
                String upgrade = request.getFirstHeader("Upgrade").orElse("");
                if ("websocket".equalsIgnoreCase(upgrade)) {
                    handleWebSocketUpgrade(request, response);
                } else {
                    // Handle regular HTTP request (for testing or fallback)
                    handleHttpRequest(request, response, writer);
                }
            } catch (Exception e) {
                logger.log(Level.SEVERE, "Error in ChatWebSocket service", e);
                response.setStatusCode(500);
                writer.write("{\"error\":\"Internal server error\"}");
            }
        }
    }

    private void handleWebSocketUpgrade(HttpRequest request, HttpResponse response) throws Exception {
        // Authenticate user
        String token = request.getFirstQueryParameter("token").orElse("");
        String userId = authenticateUser(token);
        
        if (userId == null) {
            response.setStatusCode(401);
            return;
        }

        // Create or get existing session
        String sessionId = generateSessionId();
        ChatSession session = getOrCreateSession(userId, sessionId);
        
        logger.info("WebSocket connection established for user: " + userId);
        
        // Set WebSocket headers
        response.setStatusCode(101);
        response.appendHeader("Upgrade", "websocket");
        response.appendHeader("Connection", "Upgrade");
        response.appendHeader("Sec-WebSocket-Accept", generateWebSocketAccept(request));
        
        // Start message processing for this session
        startMessageProcessing(session);
    }

    private void handleHttpRequest(HttpRequest request, HttpResponse response, BufferedWriter writer) 
            throws Exception {
        // Fallback HTTP endpoint for testing
        String token = request.getFirstHeader("Authorization")
            .filter(h -> h.startsWith("Bearer "))
            .map(h -> h.substring("Bearer ".length()))
            .orElse("");

        String userId = authenticateUser(token);
        if (userId == null) {
            response.setStatusCode(401);
            writer.write("{\"error\":\"Unauthorized\"}");
            return;
        }

        // Handle different HTTP endpoints
        String path = request.getPath();
        if (path.endsWith("/status")) {
            handleStatusRequest(userId, writer);
        } else if (path.endsWith("/history")) {
            handleHistoryRequest(userId, writer);
        } else {
            response.setStatusCode(404);
            writer.write("{\"error\":\"Endpoint not found\"}");
        }
    }

    private String authenticateUser(String token) {
        if (token == null || token.isBlank()) {
            return null;
        }
        try {
            FirebaseToken decodedToken = firebaseAuth.verifyIdToken(token);
            return decodedToken.getUid();
        } catch (FirebaseAuthException | IllegalArgumentException e) {
            logger.warning("Authentication failed: " + e.getMessage());
            return null;
        }
    }

    private ChatSession getOrCreateSession(String userId, String sessionId) {
        return activeSessions.computeIfAbsent(sessionId, 
            k -> new ChatSession(userId, sessionId));
    }

    private void startMessageProcessing(ChatSession session) {
        executorService.submit(() -> {
            try {
                processSessionMessages(session);
            } catch (Exception e) {
                logger.log(Level.SEVERE, "Error processing session: " + session.sessionId, e);
                removeSession(session.sessionId);
            }
        });
    }

    private void processSessionMessages(ChatSession session) {
        logger.info("Starting message processing for session: " + session.sessionId);
        
        // Send welcome message
        sendWelcomeMessage(session);
        
        // Process incoming messages (this would be handled by the WebSocket implementation)
        // For now, we'll simulate the processing logic
        while (activeSessions.containsKey(session.sessionId)) {
            try {
                updateSessionHeartbeat(session.sessionId);
                Thread.sleep(1000); // Process every second
                
                // Check for session timeout
                if (isSessionExpired(session)) {
                    logger.info("Session expired: " + session.sessionId);
                    removeSession(session.sessionId);
                    break;
                }
                
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }
    }

    public void handleIncomingMessage(String sessionId, WebSocketMessage wsMessage) {
        ChatSession session = activeSessions.get(sessionId);
        if (session == null) {
            logger.warning("Message received for unknown session: " + sessionId);
            return;
        }

        executorService.submit(() -> {
            try {
                processMessage(session, wsMessage);
            } catch (Exception e) {
                logger.log(Level.SEVERE, "Error processing message", e);
                sendErrorMessage(session, "Failed to process your message");
            }
        });
    }

    private void processMessage(ChatSession session, WebSocketMessage wsMessage) throws Exception {
        switch (wsMessage.type) {
            case "message":
                handleChatMessage(session, wsMessage);
                break;
            case "typing":
                handleTypingIndicator(session, wsMessage);
                break;
            case "suggestions":
                handleSuggestionsRequest(session, wsMessage);
                break;
            case "heartbeat":
                handleHeartbeat(session, wsMessage);
                break;
            default:
                logger.warning("Unknown message type: " + wsMessage.type);
        }
    }

    private void handleChatMessage(ChatSession session, WebSocketMessage wsMessage) throws Exception {
        JsonObject payload = gson.fromJson(gson.toJson(wsMessage.payload), JsonObject.class);
        ChatMessage userMessage = gson.fromJson(payload.get("message"), ChatMessage.class);
        ConversationContext context = gson.fromJson(payload.get("context"), ConversationContext.class);

        // Update session context
        session.context = context;
        session.messageHistory.add(userMessage);
        session.lastActivity = System.currentTimeMillis();

        // Generate AI response
        sendTypingIndicator(session, true);
        
        try {
            ChatMessage aiResponse = generateAIResponse(session, userMessage);
            
            sendTypingIndicator(session, false);
            sendChatMessage(session, aiResponse);
            
            // Generate contextual suggestions
            generateAndSendSuggestions(session);
            
        } catch (Exception e) {
            sendTypingIndicator(session, false);
            sendErrorMessage(session, "I apologize, but I encountered an error while processing your message.");
        }
    }

    private ChatMessage generateAIResponse(ChatSession session, ChatMessage userMessage) throws IOException {
        GenerativeModel model = new GenerativeModel(FunctionSupport.GEMINI_MODEL, vertexAI);
        
        String systemPrompt = buildSystemPrompt(session);
        String conversationHistory = buildConversationHistory(session);
        String fullPrompt = systemPrompt + "\n\nConversation History:\n" + conversationHistory + 
                          "\n\nUser: " + userMessage.content + "\n\nAssistant:";

        GenerateContentResponse response = model.generateContent(fullPrompt);
        String aiContent = response.getCandidates(0).getContent().getParts(0).getText();

        ChatMessage aiMessage = new ChatMessage();
        aiMessage.id = generateMessageId();
        aiMessage.content = aiContent.trim();
        aiMessage.sender = "assistant";
        aiMessage.timestamp = System.currentTimeMillis();
        aiMessage.type = determineMessageType(aiContent);
        aiMessage.metadata = new HashMap<>();

        session.messageHistory.add(aiMessage);
        return aiMessage;
    }

    private String buildSystemPrompt(ChatSession session) {
        StringBuilder prompt = new StringBuilder();
        prompt.append("You are the Gardener's Assistant, a gentle and wise AI companion helping users reflect on their memories and emotions. ");
        prompt.append("Your role is to provide thoughtful, empathetic responses that encourage self-reflection and emotional growth. ");
        
        if (session.context.currentMood != null) {
            prompt.append("The user's current mood seems to be: ").append(session.context.currentMood).append(". ");
        }
        
        if (session.context.recentMemories != null && !session.context.recentMemories.isEmpty()) {
            prompt.append("Recent memories context: ");
            session.context.recentMemories.stream().limit(3).forEach(memory -> 
                prompt.append("\"").append(memory.userText()).append("\" "));
        }
        
        prompt.append("\nRespond in a warm, supportive tone. Ask thoughtful questions. Offer insights about patterns or themes. ");
        prompt.append("Keep responses concise but meaningful (2-3 sentences typically). ");
        prompt.append("Use gentle language and avoid being overly clinical or formal.");
        
        return prompt.toString();
    }

    private String buildConversationHistory(ChatSession session) {
        StringBuilder history = new StringBuilder();
        session.messageHistory.stream().limit(10).forEach(message -> {
            String role = message.sender.equals("user") ? "User" : "Assistant";
            history.append(role).append(": ").append(message.content).append("\n");
        });
        return history.toString();
    }

    private String determineMessageType(String content) {
        if (content.contains("pattern") || content.contains("notice") || content.contains("insight")) {
            return "insight";
        } else if (content.contains("suggest") || content.contains("try") || content.contains("consider")) {
            return "suggestion";
        }
        return "text";
    }

    private void generateAndSendSuggestions(ChatSession session) {
        List<String> suggestions = new ArrayList<>();
        
        // Context-aware suggestions based on conversation and mood
        if ("sad".equals(session.context.currentMood)) {
            suggestions.addAll(Arrays.asList(
                "Can you help me find some positive memories?",
                "What usually helps when I'm feeling down?",
                "Tell me about a time I felt truly happy"
            ));
        } else if ("anxious".equals(session.context.currentMood)) {
            suggestions.addAll(Arrays.asList(
                "What are some calming memories I have?",
                "How can I find peace in this moment?",
                "What grounds me when I feel overwhelmed?"
            ));
        } else {
            suggestions.addAll(Arrays.asList(
                "What patterns do you notice in my memories?",
                "How have I grown recently?",
                "What should I reflect on today?",
                "Help me understand my emotions better"
            ));
        }
        
        sendSuggestions(session, suggestions);
    }

    // WebSocket message sending methods
    private void sendWelcomeMessage(ChatSession session) {
        ChatMessage welcome = new ChatMessage();
        welcome.id = generateMessageId();
        welcome.content = "Hello! I'm your Gardener's Assistant. I'm here to help you tend to your digital garden of memories. How are you feeling today?";
        welcome.sender = "assistant";
        welcome.timestamp = System.currentTimeMillis();
        welcome.type = "text";
        
        sendChatMessage(session, welcome);
    }

    private void sendChatMessage(ChatSession session, ChatMessage message) {
        WebSocketMessage wsMessage = new WebSocketMessage();
        wsMessage.type = "message";
        wsMessage.payload = message;
        wsMessage.timestamp = System.currentTimeMillis();
        
        sendWebSocketMessage(session.sessionId, wsMessage);
    }

    private void sendTypingIndicator(ChatSession session, boolean isTyping) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("isTyping", isTyping);
        payload.put("userId", session.userId);
        
        WebSocketMessage wsMessage = new WebSocketMessage();
        wsMessage.type = "typing";
        wsMessage.payload = payload;
        wsMessage.timestamp = System.currentTimeMillis();
        
        sendWebSocketMessage(session.sessionId, wsMessage);
    }

    private void sendSuggestions(ChatSession session, List<String> suggestions) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("suggestions", suggestions);
        
        WebSocketMessage wsMessage = new WebSocketMessage();
        wsMessage.type = "suggestions";
        wsMessage.payload = payload;
        wsMessage.timestamp = System.currentTimeMillis();
        
        sendWebSocketMessage(session.sessionId, wsMessage);
    }

    private void sendErrorMessage(ChatSession session, String errorText) {
        ChatMessage errorMessage = new ChatMessage();
        errorMessage.id = generateMessageId();
        errorMessage.content = errorText;
        errorMessage.sender = "assistant";
        errorMessage.timestamp = System.currentTimeMillis();
        errorMessage.type = "text";
        
        sendChatMessage(session, errorMessage);
    }

    private void sendWebSocketMessage(String sessionId, WebSocketMessage message) {
        // In a real implementation, this would send through the WebSocket connection
        logger.info("Sending WebSocket message to session " + sessionId + ": " + message.type);
        // Implementation would use the actual WebSocket connection to send the message
    }

    private void handleTypingIndicator(ChatSession session, WebSocketMessage wsMessage) {
        // Echo typing indicator to other participants if needed
        session.lastActivity = System.currentTimeMillis();
    }

    private void handleSuggestionsRequest(ChatSession session, WebSocketMessage wsMessage) {
        generateAndSendSuggestions(session);
    }

    private void handleHeartbeat(ChatSession session, WebSocketMessage wsMessage) {
        updateSessionHeartbeat(session.sessionId);
        
        // Send heartbeat response
        WebSocketMessage response = new WebSocketMessage();
        response.type = "heartbeat";
        response.payload = Map.of("timestamp", System.currentTimeMillis());
        response.timestamp = System.currentTimeMillis();
        
        sendWebSocketMessage(session.sessionId, response);
    }

    // Session management
    private void updateSessionHeartbeat(String sessionId) {
        sessionHeartbeats.put(sessionId, System.currentTimeMillis());
    }

    private boolean isSessionExpired(ChatSession session) {
        long lastHeartbeat = sessionHeartbeats.getOrDefault(session.sessionId, 0L);
        return System.currentTimeMillis() - lastHeartbeat > 60000; // 1 minute timeout
    }

    private void removeSession(String sessionId) {
        activeSessions.remove(sessionId);
        sessionHeartbeats.remove(sessionId);
        logger.info("Removed expired session: " + sessionId);
    }

    private void initializeSessionCleanup() {
        // Cleanup expired sessions every minute
        executorService.submit(() -> {
            while (true) {
                try {
                    Thread.sleep(60000); // 1 minute
                    cleanupExpiredSessions();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        });
    }

    private void cleanupExpiredSessions() {
        List<String> expiredSessions = new ArrayList<>();
        long currentTime = System.currentTimeMillis();
        
        for (Map.Entry<String, ChatSession> entry : activeSessions.entrySet()) {
            if (isSessionExpired(entry.getValue())) {
                expiredSessions.add(entry.getKey());
            }
        }
        
        expiredSessions.forEach(this::removeSession);
        
        if (!expiredSessions.isEmpty()) {
            logger.info("Cleaned up " + expiredSessions.size() + " expired sessions");
        }
    }

    // HTTP endpoint handlers
    private void handleStatusRequest(String userId, BufferedWriter writer) throws IOException {
        Map<String, Object> status = new HashMap<>();
        status.put("userId", userId);
        status.put("activeSessions", activeSessions.size());
        status.put("timestamp", System.currentTimeMillis());
        
        writer.write(gson.toJson(status));
    }

    private void handleHistoryRequest(String userId, BufferedWriter writer) throws IOException {
        // Find user's session
        ChatSession userSession = activeSessions.values().stream()
            .filter(s -> s.userId.equals(userId))
            .findFirst()
            .orElse(null);
            
        if (userSession != null) {
            writer.write(gson.toJson(userSession.messageHistory));
        } else {
            writer.write("{\"history\":[]}");
        }
    }

    // Utility methods
    private String generateSessionId() {
        return "session_" + System.currentTimeMillis() + "_" + 
               UUID.randomUUID().toString().substring(0, 8);
    }

    private String generateMessageId() {
        return "msg_" + System.currentTimeMillis() + "_" + 
               UUID.randomUUID().toString().substring(0, 8);
    }

    private String generateWebSocketAccept(HttpRequest request) {
        // Simplified WebSocket accept header generation
        return "websocket-accept-key";
    }
}
