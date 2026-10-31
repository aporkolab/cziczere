package com.cziczere.functions;

import com.google.cloud.firestore.Firestore;
import com.google.cloud.storage.Storage;
import com.google.cloud.texttospeech.v1.TextToSpeechClient;
import com.google.firebase.auth.FirebaseAuth;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import com.google.cloud.functions.HttpRequest;
import com.google.cloud.functions.HttpResponse;

import java.io.BufferedWriter;
import java.io.StringWriter;
import java.util.Optional;

import static org.mockito.Mockito.*;

import com.google.cloud.storage.BlobInfo;
import com.google.cloud.texttospeech.v1.*;
import com.google.firebase.auth.FirebaseToken;
import com.google.gson.Gson;
import com.google.protobuf.ByteString;
import org.mockito.ArgumentCaptor;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

@ExtendWith(MockitoExtension.class)
public class GetInsightAudioTest {

    @Mock private Firestore db;
    @Mock private Storage storage;
    @Mock private FirebaseAuth firebaseAuth;
    @Mock private HttpRequest request;
    @Mock private HttpResponse response;
    @Mock private TextToSpeechClientFactory textToSpeechClientFactory;
    @Mock private TextToSpeechClient textToSpeechClient;
    @Mock private FirebaseToken decodedToken;
    @Mock private com.google.cloud.firestore.CollectionReference collectionReference;
    @Mock private com.google.cloud.firestore.DocumentReference documentReference;
    @Mock private com.google.api.core.ApiFuture<com.google.cloud.firestore.DocumentSnapshot> future;
    @Mock private com.google.cloud.firestore.DocumentSnapshot documentSnapshot;

    private GetInsightAudio getInsightAudioFunction;
    private StringWriter responseWriter;
    private BufferedWriter bufferedWriter;

    @BeforeEach
    void setUp() throws Exception {
        lenient().when(request.getFirstHeader("Origin")).thenReturn(Optional.of("http://localhost:4200"));
        responseWriter = new StringWriter();
        bufferedWriter = new BufferedWriter(responseWriter);
        when(response.getWriter()).thenReturn(bufferedWriter);

        // Inject the mock factory
        getInsightAudioFunction = new GetInsightAudio(db, storage, firebaseAuth, textToSpeechClientFactory);
    }

    @Test
    void testService_Successful() throws Exception {
        // Arrange
        // Mock authentication
        when(request.getFirstHeader("Authorization")).thenReturn(Optional.of("Bearer fake-token"));
        when(firebaseAuth.verifyIdToken("fake-token")).thenReturn(decodedToken);
        when(decodedToken.getUid()).thenReturn("owner-uid");

        // Mock request parameter
        when(request.getFirstQueryParameter("insightId")).thenReturn(Optional.of("test-insight-id"));

        // Mock Firestore document retrieval
        when(db.collection("insights")).thenReturn(collectionReference);
        when(collectionReference.document("test-insight-id")).thenReturn(documentReference);
        when(documentReference.get()).thenReturn(future);
        when(future.get()).thenReturn(documentSnapshot);
        when(documentSnapshot.exists()).thenReturn(true);
        when(documentSnapshot.getString("userId")).thenReturn("owner-uid");
        when(documentSnapshot.getString("text")).thenReturn("This is a test insight.");

        // Mock Text-to-Speech client creation and speech synthesis
        when(textToSpeechClientFactory.create()).thenReturn(textToSpeechClient);
        SynthesizeSpeechResponse speechResponse = SynthesizeSpeechResponse.newBuilder()
            .setAudioContent(ByteString.copyFromUtf8("fake-audio-bytes"))
            .build();
        when(textToSpeechClient.synthesizeSpeech(any(SynthesisInput.class), any(VoiceSelectionParams.class), any(AudioConfig.class)))
            .thenReturn(speechResponse);

        // Act
        getInsightAudioFunction.service(request, response);

        // Assert
        verify(response).setStatusCode(200);

        // Verify that the storage.create method was called with the correct arguments
        ArgumentCaptor<BlobInfo> blobInfoCaptor = ArgumentCaptor.forClass(BlobInfo.class);
        ArgumentCaptor<byte[]> audioBytesCaptor = ArgumentCaptor.forClass(byte[].class);
        verify(storage).create(blobInfoCaptor.capture(), audioBytesCaptor.capture());

        BlobInfo capturedBlobInfo = blobInfoCaptor.getValue();
        assertEquals("test-insight-id.mp3", capturedBlobInfo.getName());

        byte[] capturedAudioBytes = audioBytesCaptor.getValue();
        assertEquals("fake-audio-bytes", new String(capturedAudioBytes));
    }
}
