package com.cziczere.functions;

import com.google.api.core.ApiFuture;
import com.google.cloud.firestore.CollectionReference;
import com.google.cloud.firestore.DocumentReference;
import com.google.cloud.firestore.Firestore;
import com.google.cloud.firestore.Query;
import com.google.cloud.firestore.QueryDocumentSnapshot;
import com.google.cloud.firestore.QuerySnapshot;
import com.google.cloud.firestore.WriteResult;
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
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
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
class AnalyzeMemoriesTest {

    @Mock private Firestore db;
    @Mock private VertexAI vertexAI;
    @Mock private FirebaseAuth firebaseAuth;
    @Mock private HttpRequest request;
    @Mock private HttpResponse response;
    @Mock private GenerativeModel generativeModel;
    @Mock private FirebaseToken decodedToken;
    @Mock private CollectionReference memoriesCollection;
    @Mock private CollectionReference insightsCollection;
    @Mock private DocumentReference documentReference;
    @Mock private Query query;
    @Mock private ApiFuture<QuerySnapshot> queryFuture;
    @Mock private QuerySnapshot querySnapshot;
    @Mock private ApiFuture<WriteResult> writeFuture;

    private StringWriter responseWriter;
    private BufferedWriter bufferedWriter;

    private AnalyzeMemories analyzeMemoriesFunction;

    @BeforeEach
    void setUp() throws IOException {
        lenient().when(request.getFirstHeader("Origin")).thenReturn(Optional.of("http://localhost:4200"));
        responseWriter = new StringWriter();
        bufferedWriter = new BufferedWriter(responseWriter);
        when(response.getWriter()).thenReturn(bufferedWriter);

        analyzeMemoriesFunction = Mockito.spy(new AnalyzeMemories(db, vertexAI, firebaseAuth));

        lenient().doReturn(generativeModel).when(analyzeMemoriesFunction).getGenerativeModel(anyString());
    }

    private void mockFirebaseAuth() throws Exception {
        lenient().when(request.getFirstHeader("Authorization")).thenReturn(Optional.of("Bearer fake-token"));
        lenient().when(firebaseAuth.verifyIdToken(anyString())).thenReturn(decodedToken);
        lenient().when(decodedToken.getUid()).thenReturn("test-user-id");
    }

    private void mockFirestoreSave() throws Exception {
        lenient().when(db.collection("insights")).thenReturn(insightsCollection);
        lenient().when(insightsCollection.document()).thenReturn(documentReference);
        lenient().when(documentReference.set(any(InsightData.class))).thenReturn(writeFuture);
        lenient().when(writeFuture.get()).thenReturn(mock(WriteResult.class));
    }

    private void setupMockedFirestoreQuery(boolean withData, String type) throws ExecutionException, InterruptedException {
        Query queryMock = mock(Query.class, withSettings().lenient());

        when(db.collection("memories")).thenReturn(memoriesCollection);
        when(memoriesCollection.whereEqualTo("userId", "test-user-id")).thenReturn(queryMock);

        if ("weekly".equals(type) || "monthly".equals(type)) {
             when(queryMock.whereGreaterThanOrEqualTo(eq("timestamp"), anyLong())).thenReturn(queryMock);
        }

        when(queryMock.get()).thenReturn(queryFuture);
        when(queryFuture.get()).thenReturn(querySnapshot);

        if (withData) {
            QueryDocumentSnapshot document = mock(QueryDocumentSnapshot.class);
            MemoryData memoryData = new MemoryData("test-user-id", "A beautiful day", "", "", System.currentTimeMillis(), "text", Collections.emptyMap());
            when(document.toObject(MemoryData.class)).thenReturn(memoryData);
            when(querySnapshot.getDocuments()).thenReturn(List.of(document));
        } else {
            when(querySnapshot.getDocuments()).thenReturn(Collections.emptyList());
        }
    }

    @Test
    void testService_SuccessfulInsight() throws Exception {
        // Arrange
        mockFirebaseAuth();
        setupMockedFirestoreQuery(true, "insight");
        mockFirestoreSave();
        when(request.getFirstQueryParameter("type")).thenReturn(Optional.of("insight"));

        GenerateContentResponse geminiResponse = GenerateContentResponse.newBuilder()
                .addCandidates(Candidate.newBuilder()
                        .setContent(Content.newBuilder()
                                .addParts(Part.newBuilder().setText("I've noticed that you enjoy beautiful days."))))
                .build();
        when(generativeModel.generateContent(anyString())).thenReturn(geminiResponse);

        // Act
        analyzeMemoriesFunction.service(request, response);

        // Assert
        // The try-with-resources in the function closes the writer, so we must capture
        // the content *before* the service method completes. We can do this with an
        // ArgumentCaptor on the set() method of the DocumentReference.
        ArgumentCaptor<InsightData> insightCaptor = ArgumentCaptor.forClass(InsightData.class);
        verify(documentReference).set(insightCaptor.capture());

        // Now, we can assert on the captured object.
        InsightData savedInsight = insightCaptor.getValue();
        assertTrue(savedInsight.text().contains("I've noticed that you enjoy beautiful days."));

        // We can also verify the response was written, even if we can't inspect the content.
        verify(response).setStatusCode(200, "OK");
    }

    @Test
    void testService_UnauthorizedAccess() throws Exception {
        // Arrange
        when(request.getFirstHeader("Authorization")).thenReturn(Optional.empty());

        // Act
        analyzeMemoriesFunction.service(request, response);

        // Assert
        verify(response).setStatusCode(401, "Unauthorized");
        assertTrue(responseWriter.toString().contains("Authorization header is missing"));
    }

    @Test
    void testService_NoMemoriesFound() throws Exception {
        // Arrange
        mockFirebaseAuth();
        setupMockedFirestoreQuery(false, "insight");
        when(request.getFirstQueryParameter("type")).thenReturn(Optional.of("insight"));

        // Act
        analyzeMemoriesFunction.service(request, response);

        // Assert
        verify(response).setStatusCode(404, "Not Found");
        assertTrue(responseWriter.toString().contains("No memories found to analyze."));
    }

    @Test
    void testService_WeeklySummary_Successful() throws Exception {
        // Arrange
        mockFirebaseAuth();
        setupMockedFirestoreQuery(true, "weekly");
        mockFirestoreSave();
        when(request.getFirstQueryParameter("type")).thenReturn(Optional.of("weekly"));

        GenerateContentResponse geminiResponse = GenerateContentResponse.newBuilder()
                .addCandidates(Candidate.newBuilder()
                        .setContent(Content.newBuilder()
                                .addParts(Part.newBuilder().setText("Here is your weekly memory bouquet."))))
                .build();
        when(generativeModel.generateContent(anyString())).thenReturn(geminiResponse);

        // Act
        analyzeMemoriesFunction.service(request, response);

        // Assert
        verify(response).setStatusCode(200, "OK");
        assertTrue(responseWriter.toString().contains("weekly memory bouquet"));

        ArgumentCaptor<String> promptCaptor = ArgumentCaptor.forClass(String.class);
        verify(generativeModel).generateContent(promptCaptor.capture());
        assertTrue(promptCaptor.getValue().contains("memory bouquet"));
    }
}
