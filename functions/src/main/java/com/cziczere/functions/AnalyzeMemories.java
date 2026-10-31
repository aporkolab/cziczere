package com.cziczere.functions;

import com.google.cloud.firestore.CollectionReference;
import com.google.cloud.firestore.DocumentSnapshot;
import com.google.cloud.firestore.Firestore;
import com.google.cloud.firestore.FirestoreOptions;
import com.google.cloud.firestore.Query;
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
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ExecutionException;
import java.util.logging.Level;
import java.util.logging.Logger;
import java.util.stream.Collectors;

public class AnalyzeMemories implements HttpFunction {

    private static final Logger logger = Logger.getLogger(AnalyzeMemories.class.getName());
    private static final Gson gson = new Gson();

    Firestore db;
    VertexAI vertexAI;
    FirebaseAuth firebaseAuth;

    static {
        FunctionSupport.initFirebase();
    }

    public AnalyzeMemories() throws IOException {
        this.db = FirestoreOptions.getDefaultInstance().getService();
        this.vertexAI = FunctionSupport.vertexAI();
        this.firebaseAuth = FirebaseAuth.getInstance();
    }

    // Constructor for testing
    AnalyzeMemories(Firestore db, VertexAI vertexAI, FirebaseAuth firebaseAuth) {
        this.db = db;
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
                String userId = getUserIdFromAuthToken(request);
                String analysisType = request.getFirstQueryParameter("type").orElse("insight");

                List<MemoryData> memories;
                String insightText;

                switch (analysisType) {
                    case "monthly":
                        memories = getMonthlyMemoriesForUser(userId);
                        if (memories.isEmpty()) {
                            response.setStatusCode(404, "Not Found");
                            writer.write("{\"message\":\"No memories in the last month to analyze.\"}");
                            return;
                        }
                        insightText = generateMonthlyInsight(memories);
                        break;
                    case "weekly":
                        memories = getRecentMemoriesForUser(userId);
                        if (memories.isEmpty()) {
                            response.setStatusCode(404, "Not Found");
                            writer.write("{\"message\":\"No recent memories for a weekly summary.\"}");
                            return;
                        }
                        insightText = generateWeeklySummary(memories);
                        break;
                    default: // "insight"
                        memories = getMemoriesForUser(userId);
                        if (memories.isEmpty()) {
                            response.setStatusCode(404, "Not Found");
                            writer.write("{\"message\":\"No memories found to analyze.\"}");
                            return;
                        }
                        insightText = generateStandardInsight(memories);
                        break;
                }

                InsightData newInsight = new InsightData(userId, insightText, System.currentTimeMillis(), analysisType);
                saveInsightToFirestore(newInsight);

                response.setStatusCode(200, "OK");
                writer.write(gson.toJson(newInsight));

            } catch (FunctionSupport.AuthException e) {
                logger.warning("Authentication failed: " + e.getMessage());
                response.setStatusCode(401, "Unauthorized");
                writer.write(FunctionSupport.errorJson(e.getMessage()));
            } catch (Exception e) {
                logger.log(Level.SEVERE, "Internal Server Error", e);
                response.setStatusCode(500, "Internal Server Error.");
                writer.write("{\"error\":\"An unexpected error occurred.\"}");
            }
        }
    }

    String getUserIdFromAuthToken(HttpRequest request) throws FunctionSupport.AuthException {
        return FunctionSupport.requireUserId(request, firebaseAuth);
    }

    List<MemoryData> getMemoriesForUser(String userId) throws ExecutionException, InterruptedException {
        CollectionReference memoriesCollection = db.collection("memories");
        Query query = memoriesCollection.whereEqualTo("userId", userId);
        List<com.google.cloud.firestore.QueryDocumentSnapshot> documents = query.get().get().getDocuments();

        return documents.stream()
                .map(doc -> doc.toObject(MemoryData.class))
                .filter(java.util.Objects::nonNull)
                .collect(Collectors.toList());
    }


    String generateStandardInsight(List<MemoryData> memories) throws IOException {
        String combinedMemories = memories.stream()
                .map(MemoryData::userText)
                .collect(Collectors.joining("\n---\n"));

        GenerativeModel model = getGenerativeModel(FunctionSupport.GEMINI_MODEL);
        String systemPrompt = "You are the Gardener's Assistant. Your role is to help users reflect on their memories. " +
                "You will be given a list of a user's memories, separated by '---'. " +
                "Your task is to identify a recurring positive theme, pattern, or source of joy in these memories. " +
                "Synthesize this observation into a single, gentle, and insightful sentence. " +
                "Start your response with 'I've noticed that...' or a similar gentle opening. " +
                "Address the user directly in your reflection. " +
                "Do not be generic; base your insight directly on the content provided. " +
                "For example: 'I've noticed that walks in nature seem to be a consistent source of peace for you.' " +
                "or 'It seems that spending time with your family brings you a great deal of happiness.' " +
                "Output only the single insightful sentence and nothing else.";

        String fullPrompt = systemPrompt + "\n\nHere are the user's memories:\n" + combinedMemories;

        try {
            logger.info("Generating insight with Gemini for user.");
            GenerateContentResponse response = model.generateContent(fullPrompt);
            String generatedInsight = response.getCandidates(0).getContent().getParts(0).getText();
            logger.info("Generated insight: " + generatedInsight);
            return generatedInsight.trim();
        } catch (Exception e) {
            logger.severe("Error generating insight with Gemini: " + e.getMessage());
            return "There was an error analyzing your memories, but I'm sure your garden is growing beautifully.";
        }
    }

    String generateWeeklySummary(List<MemoryData> memories) throws IOException {
        String combinedMemories = memories.stream()
                .map(m -> "Memory: " + m.userText() + "\nEmotions: " + gson.toJson(m.emotions()))
                .collect(Collectors.joining("\n---\n"));

        GenerativeModel model = getGenerativeModel(FunctionSupport.GEMINI_MODEL);
        String systemPrompt = "You are the Gardener's Assistant. You will be given a list of a user's memories and associated emotions from the past week. " +
                "Your task is to create a 'memory bouquet' (emlék-csokor). " +
                "This should be a short, poetic, and uplifting summary of the week's highlights and feelings. " +
                "Explicitly use the provided emotion data to add depth to your summary. " +
                "Weave together the key themes and emotions into a cohesive, gentle, and beautiful paragraph. " +
                "Address the user in a warm and personal tone. Start with a phrase like 'Here is your weekly bouquet of memories...' or similar. " +
                "The summary should be in English.";

        String fullPrompt = systemPrompt + "\n\nHere are the user's memories from the week:\n" + combinedMemories;

        try {
            logger.info("Generating weekly summary with Gemini for user.");
            GenerateContentResponse response = model.generateContent(fullPrompt);
            String generatedSummary = response.getCandidates(0).getContent().getParts(0).getText();
            logger.info("Generated weekly summary: " + generatedSummary);
            return generatedSummary.trim();
        } catch (Exception e) {
            logger.severe("Error generating weekly summary with Gemini: " + e.getMessage());
            return "Could not compose your weekly memory bouquet, but I hope you had a week filled with small joys.";
        }
    }

    String generateMonthlyInsight(List<MemoryData> memories) throws IOException {
        String combinedMemories = memories.stream()
                .map(m -> "Memory: " + m.userText() + "\nEmotions: " + gson.toJson(m.emotions()))
                .collect(Collectors.joining("\n---\n"));

        GenerativeModel model = getGenerativeModel(FunctionSupport.GEMINI_MODEL);
        String systemPrompt = "You are the Gardener's Assistant, a reflective and insightful AI. " +
                "You will be given a list of a user's memories and their associated emotions from the past month. " +
                "Your task is to identify deep, overarching patterns, shifts in emotion, or recurring themes that might not be obvious week-to-week. " +
                "Synthesize your observations into a thoughtful, multi-sentence paragraph that offers a kind and supportive long-term reflection. " +
                "Address the user directly. Start with a phrase that acknowledges the longer time frame, like 'Looking back on the past month...'. " +
                "Your insight should be more profound than a simple summary. " +
                "For example: 'Looking back on the past month, I've noticed a beautiful pattern of you finding moments of quiet joy in your daily routine, even when things felt challenging. It seems these small, calm moments are a real source of strength for you.' " +
                "Output only the insightful paragraph and nothing else.";

        String fullPrompt = systemPrompt + "\n\nHere are the user's memories from the month:\n" + combinedMemories;

        try {
            logger.info("Generating monthly insight with Gemini for user.");
            GenerateContentResponse response = model.generateContent(fullPrompt);
            String generatedInsight = response.getCandidates(0).getContent().getParts(0).getText();
            logger.info("Generated monthly insight: " + generatedInsight);
            return generatedInsight.trim();
        } catch (Exception e) {
            logger.severe("Error generating monthly insight with Gemini: " + e.getMessage());
            return "There was an error reflecting on your past month, but I hope it was a time of growth and discovery.";
        }
    }

    void saveInsightToFirestore(InsightData data) throws ExecutionException, InterruptedException {
        logger.info("Saving insight data to Firestore collection 'insights': " + data);
        db.collection("insights").document().set(data).get();
        logger.info("Successfully saved insight to Firestore.");
    }

    List<MemoryData> getRecentMemoriesForUser(String userId) throws ExecutionException, InterruptedException {
        CollectionReference memoriesCollection = db.collection("memories");
        long sevenDaysAgo = System.currentTimeMillis() - (7L * 24 * 60 * 60 * 1000);
        Query query = memoriesCollection
                .whereEqualTo("userId", userId)
                .whereGreaterThanOrEqualTo("timestamp", sevenDaysAgo);

        List<com.google.cloud.firestore.QueryDocumentSnapshot> documents = query.get().get().getDocuments();
        return documents.stream()
                .map(doc -> doc.toObject(MemoryData.class))
                .filter(java.util.Objects::nonNull)
                .collect(Collectors.toList());
    }

    List<MemoryData> getMonthlyMemoriesForUser(String userId) throws ExecutionException, InterruptedException {
        CollectionReference memoriesCollection = db.collection("memories");
        long thirtyDaysAgo = System.currentTimeMillis() - (30L * 24 * 60 * 60 * 1000);
        Query query = memoriesCollection
                .whereEqualTo("userId", userId)
                .whereGreaterThanOrEqualTo("timestamp", thirtyDaysAgo);

        List<com.google.cloud.firestore.QueryDocumentSnapshot> documents = query.get().get().getDocuments();
        return documents.stream()
                .map(doc -> doc.toObject(MemoryData.class))
                .filter(java.util.Objects::nonNull)
                .collect(Collectors.toList());
    }

    protected GenerativeModel getGenerativeModel(String modelName) {
        return new GenerativeModel(modelName, this.vertexAI);
    }
}
