package com.cziczere.functions;

import com.google.api.core.ApiFuture;
import com.google.cloud.firestore.CollectionReference;
import com.google.cloud.firestore.Firestore;
import com.google.cloud.firestore.Query;
import com.google.cloud.firestore.QueryDocumentSnapshot;
import com.google.cloud.firestore.QuerySnapshot;
import com.google.cloud.functions.HttpRequest;
import com.google.cloud.functions.HttpResponse;
import com.google.cloud.vertexai.VertexAI;
import com.google.cloud.vertexai.api.Candidate;
import com.google.cloud.vertexai.api.Content;
import com.google.cloud.vertexai.api.GenerateContentResponse;
import com.google.cloud.vertexai.api.Part;
import com.google.cloud.vertexai.generativeai.GenerativeModel;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseToken;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.Mockito;
import org.mockito.junit.jupiter.MockitoExtension;

import java.io.BufferedWriter;
import java.io.IOException;
import java.io.StringWriter;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ExecutionException;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class GetAtmosphereTest {

    @Mock private Firestore db;
    @Mock private VertexAI vertexAI;
    @Mock private FirebaseAuth firebaseAuth;
    @Mock private HttpRequest request;
    @Mock private HttpResponse response;
    @Mock private GenerativeModel generativeModel;
    @Mock private FirebaseToken decodedToken;
    @Mock private CollectionReference collectionReference;
    @Mock private Query query;
    @Mock private ApiFuture<QuerySnapshot> future;
    @Mock private QuerySnapshot querySnapshot;

    private StringWriter responseWriter;
    private BufferedWriter bufferedWriter;

    private GetAtmosphere getAtmosphereFunction;

    @BeforeEach
    void setUp() throws IOException {
        lenient().when(request.getFirstHeader("Origin")).thenReturn(Optional.of("http://localhost:4200"));
        responseWriter = new StringWriter();
        bufferedWriter = new BufferedWriter(responseWriter);
        when(response.getWriter()).thenReturn(bufferedWriter);

        getAtmosphereFunction = Mockito.spy(new GetAtmosphere(db, vertexAI, firebaseAuth));

        lenient().doReturn(generativeModel).when(getAtmosphereFunction).getGenerativeModel(anyString());
    }

    private void mockAuthAndServiceCall() throws Exception {
        when(request.getFirstHeader("Authorization")).thenReturn(Optional.of("Bearer fake-token"));
        when(firebaseAuth.verifyIdToken("fake-token")).thenReturn(decodedToken);
        when(decodedToken.getUid()).thenReturn("test-user-id");

        getAtmosphereFunction.service(request, response);
    }

    private void mockFirestore(boolean withData) throws Exception {
        when(db.collection("memories")).thenReturn(collectionReference);
        when(collectionReference.whereEqualTo(anyString(), anyString())).thenReturn(query);
        when(query.whereGreaterThanOrEqualTo(anyString(), anyLong())).thenReturn(query);
        when(query.get()).thenReturn(future);
        when(future.get()).thenReturn(querySnapshot);

        if (withData) {
            QueryDocumentSnapshot document = mock(QueryDocumentSnapshot.class);
            MemoryData memoryData = new MemoryData("test-user-id", "A recent memory", "", "", System.currentTimeMillis(), "text", Collections.emptyMap());
            when(document.toObject(MemoryData.class)).thenReturn(memoryData);
            when(querySnapshot.getDocuments()).thenReturn(List.of(document));
        } else {
            when(querySnapshot.getDocuments()).thenReturn(Collections.emptyList());
        }
    }

    @Test
    void testService_SuccessfulAtmosphere() throws Exception {
        // Arrange
        mockFirestore(true);
        GenerateContentResponse geminiResponse = GenerateContentResponse.newBuilder()
                .addCandidates(Candidate.newBuilder()
                        .setContent(Content.newBuilder()
                                .addParts(Part.newBuilder().setText("{\"weather\": \"Sunny\", \"backgroundColor\": \"#87CEEB\"}"))))
                .build();
        when(generativeModel.generateContent(anyString())).thenReturn(geminiResponse);

        // Act
        mockAuthAndServiceCall();

        // Assert
        verify(response).setStatusCode(200, "OK");
        assertTrue(responseWriter.toString().contains("\"weather\":\"Sunny\""));
        assertTrue(responseWriter.toString().contains("\"backgroundColor\":\"#87CEEB\""));
    }

    @Test
    void testService_NoRecentMemories_ReturnsDefault() throws Exception {
        // Arrange
        mockFirestore(false);

        // Act
        mockAuthAndServiceCall();

        // Assert
        verify(response).setStatusCode(200);
        assertTrue(responseWriter.toString().contains("\"weather\":\"Clear\""));
        assertTrue(responseWriter.toString().contains("\"backgroundColor\":\"#87CEEB\""));
    }

    @Test
    void testService_GeminiError_ReturnsFallback() throws Exception {
        // Arrange
        mockFirestore(true);
        when(generativeModel.generateContent(anyString())).thenThrow(new IOException("Gemini API is down"));

        // Act
        mockAuthAndServiceCall();

        // Assert
        verify(response).setStatusCode(200, "OK");
        assertTrue(responseWriter.toString().contains("\"weather\":\"Clear\""));
        assertTrue(responseWriter.toString().contains("\"backgroundColor\":\"#DDDDDD\""));
    }
}
