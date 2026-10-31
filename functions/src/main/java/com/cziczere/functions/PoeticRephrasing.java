package com.cziczere.functions;

import com.google.cloud.functions.HttpFunction;
import com.google.cloud.functions.HttpRequest;
import com.google.cloud.functions.HttpResponse;
import com.google.cloud.vertexai.VertexAI;
import com.google.cloud.vertexai.api.GenerateContentResponse;
import com.google.cloud.vertexai.generativeai.GenerativeModel;
import com.google.firebase.auth.FirebaseAuth;
import com.google.gson.Gson;

import java.io.BufferedWriter;
import java.io.IOException;
import java.util.Optional;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Cloud Function that provides AI-powered poetic rephrasing of user memories
 * Based on the Creative Assistant feature specification.
 */
public class PoeticRephrasing implements HttpFunction {

    private static final Logger logger = Logger.getLogger(PoeticRephrasing.class.getName());
    private static final Gson gson = new Gson();

    private static final String PROJECT_ID = FunctionSupport.PROJECT_ID;
    private static final String REGION = FunctionSupport.REGION;

    private final VertexAI vertexAI;
    private final FirebaseAuth firebaseAuth;

    GenerativeModel getGenerativeModel() {
        return new GenerativeModel(FunctionSupport.GEMINI_MODEL, vertexAI);
    }

    // Request/Response data classes
    record RephrasingRequest(String originalText) {}
    record RephrasingResponse(String poeticVersion, String suggestion) {}

    static {
        FunctionSupport.initFirebase();
    }

    public PoeticRephrasing() throws IOException {
        this.vertexAI = new VertexAI(PROJECT_ID, REGION);
        this.firebaseAuth = FirebaseAuth.getInstance();
    }

    // Constructor for testing
    PoeticRephrasing(VertexAI vertexAI, FirebaseAuth firebaseAuth) {
        this.vertexAI = vertexAI;
        this.firebaseAuth = firebaseAuth;
    }

    @Override
    public void service(HttpRequest request, HttpResponse response) throws Exception {
        if (FunctionSupport.handleCors(request, response, "POST")) {
            return;
        }
        response.appendHeader("Content-Type", "application/json");
        try (BufferedWriter writer = response.getWriter()) {
            try {
                // Authenticate user
                String userId = getUserIdFromAuthToken(request);

                // Parse request
                RephrasingRequest requestData = gson.fromJson(request.getReader(), RephrasingRequest.class);
                if (requestData == null || requestData.originalText() == null || requestData.originalText().isBlank()) {
                    response.setStatusCode(400, "Bad Request");
                    writer.write("{\"error\":\"Original text is required.\"}");
                    return;
                }

                // Generate poetic rephrasing
                RephrasingResponse result = generatePoeticRephrasing(requestData.originalText());

                response.setStatusCode(200, "OK");
                writer.write(gson.toJson(result));

            } catch (FunctionSupport.AuthException e) {
                logger.warning("Authentication failed: " + e.getMessage());
                response.setStatusCode(401, "Unauthorized");
                writer.write(FunctionSupport.errorJson(e.getMessage()));
            } catch (Exception e) {
                logger.log(Level.SEVERE, "Internal Server Error", e);
                response.setStatusCode(500, "Internal Server Error");
                writer.write("{\"error\":\"An unexpected error occurred.\"}");
            }
        }
    }

    private String getUserIdFromAuthToken(HttpRequest request) throws FunctionSupport.AuthException {
        return FunctionSupport.requireUserId(request, firebaseAuth);
    }

    RephrasingResponse generatePoeticRephrasing(String originalText) {
        GenerativeModel model = getGenerativeModel();
        
        String systemPrompt = "You are a creative writing assistant specializing in transforming everyday memories into beautiful, poetic expressions. " +
            "Your task is to take the user's memory and create a more artistic, lyrical version that captures the same essence but with enhanced imagery and emotion. " +
            "Keep the core meaning intact but elevate the language. " +
            "Respond with a JSON object containing 'poeticVersion' (the beautifully rephrased memory) and 'suggestion' (a brief explanation of what you enhanced). " +
            "Example input: 'I walked my dog in the park this morning.' " +
            "Example output: {\"poeticVersion\": \"This morning, my faithful companion and I wandered through nature's embrace, our footsteps creating a gentle rhythm on the dew-kissed pathways.\", \"suggestion\": \"I transformed your simple walk into a more vivid scene with sensory details and emotional connection.\"}";

        String fullPrompt = systemPrompt + "\n\nOriginal memory: \"" + originalText + "\"";

        try {
            logger.info("Generating poetic rephrasing with Gemini");
            GenerateContentResponse response = model.generateContent(fullPrompt);
            String responseText = response.getCandidates(0).getContent().getParts(0).getText();

            RephrasingResponse result = FunctionSupport.extractJsonObject(responseText)
                .map(json -> gson.fromJson(json, RephrasingResponse.class))
                .filter(r -> r.poeticVersion() != null && !r.poeticVersion().isBlank())
                .orElse(null);
            if (result != null) {
                return result;
            }
            logger.warning("Gemini returned no usable poetic rephrasing, using fallback.");
        } catch (Exception e) {
            logger.log(Level.SEVERE, "Error generating poetic rephrasing: " + e.getMessage(), e);
        }
        return new RephrasingResponse(
            "Your memory sparkles with its own unique beauty, waiting to unfold in the garden of your heart.",
            "I encountered an issue, but your original memory is already meaningful as it is."
        );
    }

}
