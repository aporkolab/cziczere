package com.cziczere.functions;

import com.google.cloud.firestore.Firestore;
import com.google.cloud.firestore.FirestoreOptions;
import com.google.cloud.functions.HttpFunction;
import com.google.cloud.functions.HttpRequest;
import com.google.cloud.functions.HttpResponse;
import com.google.cloud.vertexai.VertexAI;
import com.google.cloud.vertexai.api.GenerateContentResponse;
import com.google.cloud.vertexai.generativeai.GenerativeModel;
import com.google.gson.Gson;
import com.google.gson.JsonParseException;
import com.google.firebase.auth.FirebaseAuth;
import com.google.cloud.aiplatform.v1.Blob;
import com.google.cloud.aiplatform.v1.Content;
import com.google.cloud.aiplatform.v1.EndpointName;
import com.google.cloud.aiplatform.v1.GenerateContentRequest;
import com.google.cloud.aiplatform.v1.GenerationConfig;
import com.google.cloud.aiplatform.v1.Part;
import com.google.cloud.aiplatform.v1.PredictResponse;
import com.google.cloud.aiplatform.v1.PredictionServiceClient;
import com.google.cloud.aiplatform.v1.PredictionServiceSettings;
import com.google.cloud.storage.BlobId;
import com.google.cloud.storage.BlobInfo;
import com.google.cloud.storage.Storage;
import com.google.cloud.storage.StorageOptions;
import com.google.protobuf.ByteString;
import com.google.protobuf.Struct;
import com.google.protobuf.Value;

import java.io.BufferedWriter;
import java.io.IOException;
import java.util.Base64;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.logging.Level;
import java.util.logging.Logger;

import static com.cziczere.functions.FunctionSupport.PROJECT_ID;
import static com.cziczere.functions.FunctionSupport.REGION;

public class GenerateMemoryPlant implements HttpFunction {

    private static final Logger logger = Logger.getLogger(GenerateMemoryPlant.class.getName());
    private static final Gson gson = new Gson();

    private final Firestore db;
    private final VertexAI vertexAI;
    private final Storage storage;
    private final FirebaseAuth firebaseAuth;

    private static final String GCS_BUCKET_NAME = FunctionSupport.env("GCS_BUCKET_NAME", "your-gcs-bucket-name");

    // A record to hold the structured response from Gemini.
    record GeminiResponse(String imagePrompt, Map<String, Double> emotions) {}

    static {
        FunctionSupport.initFirebase();
    }

    public GenerateMemoryPlant() throws IOException {
        this.db = FirestoreOptions.getDefaultInstance().getService();
        this.vertexAI = FunctionSupport.vertexAI();
        this.storage = StorageOptions.newBuilder().setProjectId(PROJECT_ID).build().getService();
        this.firebaseAuth = FirebaseAuth.getInstance();
    }

    // This constructor is used for testing, allowing injection of mocks.
    GenerateMemoryPlant(Firestore db, VertexAI vertexAI, Storage storage, FirebaseAuth firebaseAuth) {
        this.db = db;
        this.vertexAI = vertexAI;
        this.storage = storage;
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
                // Authenticate user first
                String userId = getUserIdFromAuthToken(request);

                // Then process the request
                RequestData requestData = gson.fromJson(request.getReader(), RequestData.class);
                if (requestData == null || requestData.text() == null || requestData.text().isBlank()) {
                    response.setStatusCode(400, "Bad Request: 'text' field is required and cannot be empty.");
                    writer.write("{\"error\":\"'text' field is required and cannot be empty.\"}");
                    return;
                }
                String userText = requestData.text();

                GeminiResponse geminiResponse = generateAnalysisWithGemini(userText);
                String imageUrl = generateImage(geminiResponse.imagePrompt());

                MemoryData newMemory = new MemoryData(
                    userId,
                    userText,
                    geminiResponse.imagePrompt(),
                    imageUrl,
                    System.currentTimeMillis(),
                    "memory",
                    geminiResponse.emotions()
                );
                saveToFirestore(newMemory);

                response.setStatusCode(200, "OK");
                writer.write(gson.toJson(newMemory));

            } catch (FunctionSupport.AuthException e) {
                logger.warning("Authentication failed: " + e.getMessage());
                response.setStatusCode(401, "Unauthorized");
                writer.write(FunctionSupport.errorJson(e.getMessage()));
            } catch (JsonParseException e) {
                logger.severe("Error parsing JSON request: " + e.getMessage());
                response.setStatusCode(400, "Bad Request: Invalid JSON format.");
                writer.write("{\"error\":\"Invalid JSON format.\"}");
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

    GeminiResponse generateAnalysisWithGemini(String userText) throws IOException {
        GenerativeModel model = getGenerativeModel();
        String systemPrompt = "You are a creative and analytical assistant. Based on the user's text, perform two tasks: " +
            "1. Generate an English, artistic prompt for an image generation AI. The prompt should be descriptive, emotional, and visual. " +
            "Style: 'digital painting, surreal, magical realism, glowing elements'. " +
            "2. Analyze the text for nuanced emotions. Identify up to 5 key emotions and provide a score from 0.0 to 1.0. " +
            "Your output MUST be a valid JSON object with two keys: 'imagePrompt' (string) and 'emotions' (a map of emotion names to scores). " +
            "For example: {\"imagePrompt\": \"...\", \"emotions\": {\"nostalgia\": 0.8, \"joy\": 0.6}}. " +
            "Do not output anything else, just the raw JSON.";

        String fullPrompt = systemPrompt + "\nUser's text: \"" + userText + "\"";

        try {
            logger.info("Generating analysis with Gemini (" + userText.length() + " chars).");
            GenerateContentResponse response = model.generateContent(fullPrompt);
            String responseText = response.getCandidates(0).getContent().getParts(0).getText();

            Optional<GeminiResponse> parsed = FunctionSupport.extractJsonObject(responseText)
                .map(json -> gson.fromJson(json, GeminiResponse.class))
                .filter(r -> r.imagePrompt() != null && !r.imagePrompt().isBlank());
            if (parsed.isPresent()) {
                GeminiResponse geminiResponse = parsed.get();
                Map<String, Double> emotions = geminiResponse.emotions() != null
                    ? geminiResponse.emotions()
                    : Collections.emptyMap();
                return new GeminiResponse(geminiResponse.imagePrompt(), emotions);
            }
            logger.warning("Failed to find or parse a valid JSON object from Gemini response. Using fallback.");
        } catch (Exception e) {
            logger.log(Level.SEVERE, "Error generating or parsing Gemini response: " + e.getMessage(), e);
        }
        String fallbackPrompt = String.format("A beautiful digital painting of %s, magical realism style.", userText);
        return new GeminiResponse(fallbackPrompt, Collections.singletonMap("unknown", 0.5));
    }

    String generateImage(String imagePrompt) throws IOException {
        PredictionServiceSettings settings = PredictionServiceSettings.newBuilder()
            .setEndpoint(FunctionSupport.vertexHost(REGION) + ":443").build();
        EndpointName model = EndpointName.ofProjectLocationPublisherModelName(
            PROJECT_ID, REGION, "google", FunctionSupport.IMAGEN_MODEL);
        try (PredictionServiceClient client = PredictionServiceClient.create(settings)) {
            Blob image = FunctionSupport.IMAGEN_MODEL.startsWith("imagen-")
                ? predictImagen(client, model, imagePrompt) : generateGeminiImage(client, model, imagePrompt);
            String extension = switch (image.getMimeType()) {
                case "image/png" -> ".png";
                case "image/jpeg" -> ".jpg";
                case "image/webp" -> ".webp";
                default -> throw new IOException("Unsupported image type from Vertex AI.");
            };
            if (image.getData().isEmpty()) {
                throw new IOException("Vertex AI returned an empty image.");
            }
            BlobInfo info = BlobInfo.newBuilder(BlobId.of(GCS_BUCKET_NAME, UUID.randomUUID() + extension))
                .setContentType(image.getMimeType()).build();
            return MediaStorage.upload(storage, info, image.getData().toByteArray());
        }
    }

    static Blob generateGeminiImage(PredictionServiceClient client, EndpointName model, String prompt)
            throws IOException {
        GenerateContentRequest request = GenerateContentRequest.newBuilder()
            .setModel(model.toString())
            .addContents(Content.newBuilder().setRole("user").addParts(Part.newBuilder().setText(prompt)))
            .setGenerationConfig(GenerationConfig.newBuilder()
                .addResponseModalities(GenerationConfig.Modality.TEXT)
                .addResponseModalities(GenerationConfig.Modality.IMAGE))
            .build();
        var response = client.generateContent(request);
        for (var candidate : response.getCandidatesList()) {
            for (Part part : candidate.getContent().getPartsList()) {
                if (!part.getThought() && part.hasInlineData() && part.getInlineData().getMimeType().startsWith("image/")) {
                    return part.getInlineData();
                }
            }
        }
        throw new IOException("Gemini returned no image (the prompt may have been filtered).");
    }

    private static Blob predictImagen(PredictionServiceClient client, EndpointName model, String prompt)
            throws IOException {
        PredictResponse response = client.predict(model, List.of(buildImagenInstance(prompt)), buildImagenParameters());
        if (response.getPredictionsCount() == 0) {
            throw new IOException("Imagen returned no predictions (the prompt may have been filtered).");
        }
        Map<String, Value> fields = response.getPredictions(0).getStructValue().getFieldsMap();
        Value encoded = fields.get("bytesBase64Encoded");
        if (encoded == null || encoded.getStringValue().isEmpty()) {
            throw new IOException("Imagen prediction did not contain image bytes.");
        }
        String mimeType = fields.containsKey("mimeType") ? fields.get("mimeType").getStringValue() : "image/png";
        return Blob.newBuilder().setMimeType(mimeType)
            .setData(ByteString.copyFrom(Base64.getDecoder().decode(encoded.getStringValue()))).build();
    }

    /** Builds the Imagen request instance; the prompt is set as a proto value, never spliced into JSON text. */
    static Value buildImagenInstance(String imagePrompt) {
        return Value.newBuilder()
            .setStructValue(Struct.newBuilder()
                .putFields("prompt", Value.newBuilder().setStringValue(imagePrompt).build()))
            .build();
    }

    static Value buildImagenParameters() {
        return Value.newBuilder()
            .setStructValue(Struct.newBuilder()
                .putFields("sampleCount", Value.newBuilder().setNumberValue(1).build()))
            .build();
    }

    void saveToFirestore(MemoryData data) throws ExecutionException, InterruptedException {
        logger.info("Saving memory for user " + data.userId() + " to Firestore collection 'memories'.");
        db.collection("memories").document().set(data).get();
        logger.info("Successfully saved data to Firestore.");
    }

    /**
     * Factory method for creating a GenerativeModel.
     * This is to allow for easier mocking in tests.
     */
    GenerativeModel getGenerativeModel() throws IOException {
        return new GenerativeModel(FunctionSupport.GEMINI_MODEL, this.vertexAI);
    }
}
