package com.cziczere.functions;

import com.google.cloud.firestore.CollectionReference;
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
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ExecutionException;
import java.util.logging.Level;
import java.util.logging.Logger;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

public class GetAtmosphere implements HttpFunction {

    private static final Logger logger = Logger.getLogger(GetAtmosphere.class.getName());
    private static final Gson gson = new Gson();

    private static final String PROJECT_ID = FunctionSupport.PROJECT_ID;
    private static final String REGION = FunctionSupport.REGION;

    private static final Set<String> POSITIVE_EMOTIONS = Set.of(
        "joy", "happiness", "gratitude", "love", "excitement", "contentment", "hope",
        "pride", "delight", "amusement", "awe", "wonder", "optimism", "affection", "elation");
    private static final Set<String> NEGATIVE_EMOTIONS = Set.of(
        "sadness", "grief", "anger", "fear", "anxiety", "loneliness", "regret", "frustration",
        "disappointment", "shame", "guilt", "stress", "melancholy", "sorrow", "despair");
    private static final Set<String> CALM_EMOTIONS = Set.of(
        "calm", "peace", "serenity", "tranquility", "relaxation", "nostalgia", "reflection");
    private static final Set<String> WEATHER_TYPES = Set.of("Clear", "Sunny", "Rainy", "Snowy", "Foggy", "Stormy");
    private static final Pattern HEX_COLOR = Pattern.compile("^#[0-9a-fA-F]{6}$");
    private static final AtmosphereData FALLBACK_ATMOSPHERE = new AtmosphereData("Clear", "#DDDDDD", "sounds/calm.mp3");

    Firestore db;
    VertexAI vertexAI;
    FirebaseAuth firebaseAuth;

    // Simple record for the response
    public record AtmosphereData(String weather, String backgroundColor, String soundUrl) {}

    static {
        FunctionSupport.initFirebase();
    }

    public GetAtmosphere() throws IOException {
        this(FirestoreOptions.getDefaultInstance().getService(), new VertexAI(PROJECT_ID, REGION), FirebaseAuth.getInstance());
    }

    // Constructor for testing
    GetAtmosphere(Firestore db, VertexAI vertexAI, FirebaseAuth firebaseAuth) {
        this.db = db;
        this.vertexAI = vertexAI;
        this.firebaseAuth = firebaseAuth;
    }

    @Override
    public void service(HttpRequest request, HttpResponse response) throws Exception {
        if (FunctionSupport.handleCors(request, response, "POST, GET")) {
            return;
        }
        response.appendHeader("Content-Type", "application/json");

        try (BufferedWriter writer = response.getWriter()) {
            try {
                String userId = getUserIdFromAuthToken(request);

                // 1. Fetch recent memories
                List<MemoryData> memories = getRecentMemoriesForUser(userId);
                if (memories.isEmpty()) {
                    // Return a default atmosphere if no recent memories
                    AtmosphereData defaultAtmosphere = new AtmosphereData("Clear", "#87CEEB", "sounds/calm.mp3"); // Sky Blue
                    writer.write(gson.toJson(defaultAtmosphere));
                    response.setStatusCode(200);
                    return;
                }

                // 2. Generate atmosphere from memories
                AtmosphereData atmosphere = generateAtmosphereWithGemini(memories);

                // 3. Select sound based on mood
                String soundUrl = selectSoundForMood(memories);
                AtmosphereData finalAtmosphere = new AtmosphereData(atmosphere.weather(), atmosphere.backgroundColor(), soundUrl);


                // 4. Return atmosphere
                response.setStatusCode(200, "OK");
                writer.write(gson.toJson(finalAtmosphere));

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

    List<MemoryData> getRecentMemoriesForUser(String userId) throws ExecutionException, InterruptedException {
        CollectionReference memoriesCollection = db.collection("memories");

        // Calculate timestamp for 7 days ago
        long sevenDaysAgo = Instant.now().minus(7, ChronoUnit.DAYS).toEpochMilli();

        Query query = memoriesCollection
                .whereEqualTo("userId", userId)
                .whereGreaterThanOrEqualTo("timestamp", sevenDaysAgo);

        List<com.google.cloud.firestore.QueryDocumentSnapshot> documents = query.get().get().getDocuments();

        return documents.stream()
                .map(doc -> doc.toObject(MemoryData.class))
                .filter(Objects::nonNull)
                .collect(Collectors.toList());
    }


    AtmosphereData generateAtmosphereWithGemini(List<MemoryData> memories) throws IOException {
        String combinedMemories = memories.stream()
                .map(MemoryData::userText)
                .collect(Collectors.joining("\n---\n"));

        GenerativeModel model = getGenerativeModel(FunctionSupport.GEMINI_MODEL);
        String systemPrompt = "You are an AI that determines the atmosphere of a digital garden based on a user's recent memories. " +
                "Analyze the overall sentiment and themes from the memories provided. " +
                "Based on your analysis, you must choose ONE weather condition from this list: [Clear, Sunny, Rainy, Snowy, Foggy, Stormy]. " +
                "You must also determine a single HEX color code for the sky that reflects the mood. " +
                "Your response MUST be a valid JSON object with two keys: 'weather' and 'backgroundColor'. " +
                "For example: {\"weather\": \"Sunny\", \"backgroundColor\": \"#87CEEB\"}. " +
                "Do not add any other text or explanation. Your output must be only the JSON object.";

        String fullPrompt = systemPrompt + "\n\nHere are the user's memories:\n" + combinedMemories;

        try {
            logger.info("Generating atmosphere with Gemini.");
            GenerateContentResponse response = model.generateContent(fullPrompt);
            String rawResponse = response.getCandidates(0).getContent().getParts(0).getText();

            AtmosphereData data = FunctionSupport.extractJsonObject(rawResponse)
                .map(json -> gson.fromJson(json, AtmosphereData.class))
                .orElse(null);
            if (data == null || data.weather() == null || !WEATHER_TYPES.contains(data.weather())
                || data.backgroundColor() == null || !HEX_COLOR.matcher(data.backgroundColor()).matches()) {
                logger.warning("Gemini returned an invalid atmosphere, using fallback: " + rawResponse);
                return FALLBACK_ATMOSPHERE;
            }
            return new AtmosphereData(data.weather(), data.backgroundColor(), ""); // soundUrl is handled separately
        } catch (Exception e) {
            logger.log(Level.SEVERE, "Error generating or parsing atmosphere with Gemini: " + e.getMessage(), e);
            return FALLBACK_ATMOSPHERE;
        }
    }

    /**
     * Picks a soundscape from the emotion analysis. Scores are intensities in [0, 1], so the
     * mood comes from the emotion names: positive minus negative intensity, averaged.
     */
    static String selectSoundForMood(List<MemoryData> memories) {
        double valence = 0;
        double calmness = 0;
        int emotionCount = 0;

        for (MemoryData memory : memories) {
            if (memory.emotions() == null) {
                continue;
            }
            for (Map.Entry<String, Double> emotion : memory.emotions().entrySet()) {
                if (emotion.getKey() == null || emotion.getValue() == null) {
                    continue;
                }
                String name = emotion.getKey().toLowerCase(Locale.ROOT);
                if (POSITIVE_EMOTIONS.contains(name)) {
                    valence += emotion.getValue();
                } else if (NEGATIVE_EMOTIONS.contains(name)) {
                    valence -= emotion.getValue();
                } else if (CALM_EMOTIONS.contains(name)) {
                    calmness += emotion.getValue();
                }
                emotionCount++;
            }
        }

        if (emotionCount == 0) {
            return "sounds/neutral.mp3";
        }

        double averageValence = valence / emotionCount;
        if (averageValence > 0.25) {
            return "sounds/happy.mp3";
        } else if (averageValence < -0.25) {
            return "sounds/sad.mp3";
        } else if (calmness / emotionCount > 0.25) {
            return "sounds/calm.mp3";
        }
        return "sounds/neutral.mp3";
    }

    protected GenerativeModel getGenerativeModel(String modelName) {
        return new GenerativeModel(modelName, this.vertexAI);
    }
}
