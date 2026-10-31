package com.cziczere.functions;

import com.google.cloud.firestore.Firestore;
import com.google.cloud.functions.HttpRequest;
import com.google.cloud.functions.HttpResponse;
import com.google.gson.Gson;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;
import java.awt.image.BufferedImage;
import java.io.BufferedWriter;
import java.io.StringWriter;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ExportGardenTest {

    @Mock private Firestore db;
    @Mock private HttpRequest request;
    @Mock private HttpResponse response;
    @Mock private BufferedWriter bufferedWriter; // Mock the writer

    @BeforeEach
    void setUp() throws Exception {
        lenient().when(request.getFirstHeader("Origin")).thenReturn(Optional.of("http://localhost:4200"));
        // When getWriter() is called on the mocked response, return our mocked writer
        when(response.getWriter()).thenReturn(bufferedWriter);
    }

    @Test
    void service_shouldReturnPoster_whenMemoriesExist() throws Exception {
        // Arrange
        ExportGarden exportGarden = spy(new ExportGarden(db, mock(com.google.firebase.auth.FirebaseAuth.class)));
        String testUserId = "test-user-123";
        List<MemoryData> memories = List.of(
            new MemoryData(testUserId, "Test Memory", "p1", "url1", 1L, "memory", Collections.emptyMap())
        );
        BufferedImage dummyImage = new BufferedImage(100, 100, BufferedImage.TYPE_INT_ARGB);
        ArgumentCaptor<String> captor = ArgumentCaptor.forClass(String.class);


        doReturn(testUserId).when(exportGarden).getUserIdFromAuthToken(any());
        doReturn(memories).when(exportGarden).getMemoriesForUser(testUserId);
        doReturn(dummyImage).when(exportGarden).fetchImage(anyString());

        // Act
        exportGarden.service(request, response);
        bufferedWriter.flush();

        // Assert
        verify(response).setStatusCode(200, "OK");
        verify(bufferedWriter).write(captor.capture());
        ExportGarden.PosterResponse posterResponse = new Gson().fromJson(captor.getValue(), ExportGarden.PosterResponse.class);
        assertNotNull(posterResponse.base64Image());
        assertTrue(posterResponse.base64Image().length() > 100);
    }

    @Test
    void service_shouldReturnNotFound_whenNoMemories() throws Exception {
        // Arrange
        ExportGarden gardenExporter = spy(new ExportGarden(db, mock(com.google.firebase.auth.FirebaseAuth.class)));
        String testUserId = "test-user-123";
        ArgumentCaptor<String> captor = ArgumentCaptor.forClass(String.class);

        doReturn(testUserId).when(gardenExporter).getUserIdFromAuthToken(any());
        doReturn(Collections.emptyList()).when(gardenExporter).getMemoriesForUser(testUserId);

        // Act
        gardenExporter.service(request, response);

        // Assert
        verify(response).setStatusCode(404, "Not Found");
        verify(bufferedWriter).write(captor.capture());
        assertTrue(captor.getValue().contains("No memories found"));
    }
}
