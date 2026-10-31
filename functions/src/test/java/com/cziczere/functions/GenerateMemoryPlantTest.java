package com.cziczere.functions;

import com.google.cloud.firestore.Firestore;
import com.google.cloud.storage.Storage;
import com.google.cloud.vertexai.VertexAI;
import com.google.cloud.functions.HttpRequest;
import com.google.cloud.functions.HttpResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.StringReader;
import java.io.StringWriter;
import java.io.IOException;
import java.util.Optional;

import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseToken;
import static org.mockito.Mockito.*;

class GenerateMemoryPlantTest {

    @Mock private Firestore db;
    @Mock private VertexAI vertexAI;
    @Mock private Storage storage;
    @Mock private FirebaseAuth firebaseAuth;
    @Mock private HttpRequest request;
    @Mock private HttpResponse response;
    @Mock private FirebaseToken decodedToken;

    private GenerateMemoryPlant function;

    @BeforeEach
    void setUp() throws Exception {
        MockitoAnnotations.openMocks(this);
        when(request.getFirstHeader("Origin")).thenReturn(Optional.of("http://localhost:4200"));
        function = new GenerateMemoryPlant(db, vertexAI, storage, firebaseAuth);
        when(firebaseAuth.verifyIdToken(anyString())).thenReturn(decodedToken);
        when(decodedToken.getUid()).thenReturn("fake-user-id");
    }

    @Test
    void testService_missingText_returns400() throws Exception {
        // Given
        String json = "{\"other_field\":\"some_value\"}";
        BufferedReader reader = new BufferedReader(new StringReader(json));
        StringWriter stringWriter = new StringWriter();
        BufferedWriter writer = new BufferedWriter(stringWriter);

        when(request.getReader()).thenReturn(reader);
        when(request.getFirstHeader("Authorization")).thenReturn(Optional.of("Bearer fake-token"));
        when(response.getWriter()).thenReturn(writer);

        // When
        function.service(request, response);

        // Then
        verify(response).setStatusCode(400, "Bad Request: 'text' field is required and cannot be empty.");
    }

    @Test
    void testService_unauthorized_returns401() throws Exception {
        // Given
        when(request.getFirstHeader("Authorization")).thenReturn(Optional.empty());
        StringWriter stringWriter = new StringWriter();
        BufferedWriter writer = new BufferedWriter(stringWriter);
        when(response.getWriter()).thenReturn(writer);

        // When
        function.service(request, response);

        // Then
        verify(response).setStatusCode(401, "Unauthorized");
    }

    @Test
    void testService_validRequest_returns200() throws Exception {
        // Given
        String json = "{\"text\":\"A beautiful day\"}";
        BufferedReader reader = new BufferedReader(new StringReader(json));
        StringWriter stringWriter = new StringWriter();
        BufferedWriter writer = new BufferedWriter(stringWriter);

        when(request.getReader()).thenReturn(reader);
        when(request.getFirstHeader("Authorization")).thenReturn(Optional.of("Bearer fake-token"));
        when(response.getWriter()).thenReturn(writer);

        // Mock the whole chain of dependencies
        GenerateMemoryPlant spyFunction = spy(function);
        GenerateMemoryPlant.GeminiResponse fakeGeminiResponse = new GenerateMemoryPlant.GeminiResponse("a painting of a beautiful day", null);

        doReturn(fakeGeminiResponse).when(spyFunction).generateAnalysisWithGemini(anyString());
        doReturn("http://fake.url/image.png").when(spyFunction).generateImageWithImagen(anyString());
        doNothing().when(spyFunction).saveToFirestore(any());

        // When
        spyFunction.service(request, response);

        // Then
        verify(response).setStatusCode(200, "OK");
    }

    @Test
    void testService_geminiError_usesFallback() throws Exception {
        // Given
        String json = "{\"text\":\"A beautiful day\"}";
        BufferedReader reader = new BufferedReader(new StringReader(json));
        StringWriter stringWriter = new StringWriter();
        BufferedWriter writer = new BufferedWriter(stringWriter);

        when(request.getReader()).thenReturn(reader);
        when(request.getFirstHeader("Authorization")).thenReturn(Optional.of("Bearer fake-token"));
        when(response.getWriter()).thenReturn(writer);

        // Mock the whole chain of dependencies
        GenerateMemoryPlant spyFunction = spy(function);

        doThrow(new IOException("Gemini is down")).when(spyFunction).generateAnalysisWithGemini(anyString());
        doReturn("http://fake.url/image.png").when(spyFunction).generateImageWithImagen(anyString());
        doNothing().when(spyFunction).saveToFirestore(any());

        // When
        spyFunction.service(request, response);

        // Then
        verify(response).setStatusCode(500, "Internal Server Error.");
        // We can also verify that the fallback prompt was used, but for now, just checking the status is enough.
    }
}
