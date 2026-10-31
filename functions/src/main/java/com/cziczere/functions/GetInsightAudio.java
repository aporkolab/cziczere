package com.cziczere.functions;

import com.google.cloud.firestore.DocumentSnapshot;
import com.google.cloud.firestore.Firestore;
import com.google.cloud.functions.HttpFunction;
import com.google.cloud.functions.HttpRequest;
import com.google.cloud.functions.HttpResponse;
import com.google.cloud.storage.BlobId;
import com.google.cloud.storage.BlobInfo;
import com.google.cloud.storage.Storage;
import com.google.cloud.texttospeech.v1.*;
import com.google.firebase.auth.FirebaseAuth;
import com.google.gson.Gson;
import com.google.protobuf.ByteString;

import java.io.BufferedWriter;
import java.util.Collections;
import java.util.Optional;
import java.util.logging.Level;
import java.util.logging.Logger;

public class GetInsightAudio implements HttpFunction {

    private static final Logger logger = Logger.getLogger(GetInsightAudio.class.getName());
    private static final Gson gson = new Gson();
    private static final String BUCKET_NAME = FunctionSupport.env("INSIGHT_AUDIO_BUCKET", FunctionSupport.PROJECT_ID + "-insight-audio");


    private final Firestore db;
    private final Storage storage;
    private final FirebaseAuth firebaseAuth;
    private final TextToSpeechClientFactory textToSpeechClientFactory;

    static {
        FunctionSupport.initFirebase();
    }

    public GetInsightAudio() throws Exception {
        // This constructor will be used by the Functions Framework
        // It should initialize the clients using application default credentials
        this.db = com.google.cloud.firestore.FirestoreOptions.getDefaultInstance().getService();
        this.storage = com.google.cloud.storage.StorageOptions.getDefaultInstance().getService();
        this.firebaseAuth = FirebaseAuth.getInstance();
        this.textToSpeechClientFactory = new DefaultTextToSpeechClientFactory();
    }

    // Constructor for testing
    GetInsightAudio(Firestore db, Storage storage, FirebaseAuth firebaseAuth, TextToSpeechClientFactory textToSpeechClientFactory) {
        this.db = db;
        this.storage = storage;
        this.firebaseAuth = firebaseAuth;
        this.textToSpeechClientFactory = textToSpeechClientFactory;
    }


    @Override
    public void service(HttpRequest request, HttpResponse response) throws Exception {
        if (FunctionSupport.handleCors(request, response, "GET")) {
            return;
        }
        response.appendHeader("Content-Type", "application/json");

        try (BufferedWriter writer = response.getWriter()) {
            try {
                String userId = FunctionSupport.requireUserId(request, firebaseAuth);

                Optional<String> insightIdOpt = request.getFirstQueryParameter("insightId").filter(id -> !id.isBlank());
                if (insightIdOpt.isEmpty()) {
                    response.setStatusCode(400, "Bad Request");
                    writer.write(FunctionSupport.errorJson("insightId parameter is missing."));
                    return;
                }
                String insightId = insightIdOpt.get();

                DocumentSnapshot insightDoc = db.collection("insights").document(insightId).get().get();
                // Report foreign insights as missing so IDs of other users cannot be probed.
                if (!insightDoc.exists() || !userId.equals(insightDoc.getString("userId"))) {
                    response.setStatusCode(404, "Not Found");
                    writer.write(FunctionSupport.errorJson("Insight not found."));
                    return;
                }
                String textToSynthesize = insightDoc.getString("text");
                if (textToSynthesize == null || textToSynthesize.isBlank()) {
                    response.setStatusCode(400, "Bad Request");
                    writer.write(FunctionSupport.errorJson("Insight has no text to synthesize."));
                    return;
                }

                byte[] audioBytes = synthesizeText(textToSynthesize);

                String blobName = insightId + ".mp3";
                BlobId blobId = BlobId.of(BUCKET_NAME, blobName);
                BlobInfo blobInfo = BlobInfo.newBuilder(blobId).setContentType("audio/mpeg").build();
                String audioUrl = MediaStorage.upload(storage, blobInfo, audioBytes);
                response.setStatusCode(200);
                writer.write(gson.toJson(Collections.singletonMap("audioUrl", audioUrl)));
            } catch (FunctionSupport.AuthException e) {
                logger.warning("Authentication failed: " + e.getMessage());
                response.setStatusCode(401, "Unauthorized");
                writer.write(FunctionSupport.errorJson(e.getMessage()));
            } catch (Exception e) {
                logger.log(Level.SEVERE, "Internal Server Error in GetInsightAudio", e);
                response.setStatusCode(500, "Internal Server Error");
                writer.write(FunctionSupport.errorJson("An unexpected error occurred."));
            }
        }
    }

    private byte[] synthesizeText(String text) throws Exception {
        // Instantiates a client
        try (TextToSpeechClient textToSpeechClient = textToSpeechClientFactory.create()) {
            // Set the text input to be synthesized
            SynthesisInput input = SynthesisInput.newBuilder().setText(text).build();

            // Build the voice request
            VoiceSelectionParams voice =
                VoiceSelectionParams.newBuilder()
                    .setLanguageCode("en-US")
                    .setSsmlGender(SsmlVoiceGender.NEUTRAL)
                    .setName("en-US-Journey-F") // A calm, pleasant voice
                    .build();

            // Select the type of audio file you want returned
            AudioConfig audioConfig =
                AudioConfig.newBuilder().setAudioEncoding(AudioEncoding.MP3).build();

            // Perform the text-to-speech request
            SynthesizeSpeechResponse response =
                textToSpeechClient.synthesizeSpeech(input, voice, audioConfig);

            // Get the audio contents from the response
            ByteString audioContents = response.getAudioContent();
            return audioContents.toByteArray();
        }
    }
}
