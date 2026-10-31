package com.cziczere.functions;

import com.google.cloud.aiplatform.v1.*;
import com.google.protobuf.ByteString;
import java.io.IOException;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class LocalVertexTest {
    @Test
    void resolvesPublishedVertexEndpoints() {
        assertEquals("aiplatform.googleapis.com", FunctionSupport.vertexHost("global"));
        assertEquals("aiplatform.eu.rep.googleapis.com", FunctionSupport.vertexHost("eu"));
        assertEquals("us-central1-aiplatform.googleapis.com", FunctionSupport.vertexHost("us-central1"));
    }

    @Test
    void requestsAnImageAndReturnsTheVisibleImageWithItsMimeType() throws IOException {
        PredictionServiceClient client = mock(PredictionServiceClient.class);
        EndpointName model = EndpointName.ofProjectLocationPublisherModelName("demo-test", "global",
            "google", "gemini-3.1-flash-image");
        Blob image = Blob.newBuilder().setMimeType("image/jpeg").setData(ByteString.copyFromUtf8("image")).build();
        GenerateContentResponse response = GenerateContentResponse.newBuilder()
            .addCandidates(Candidate.newBuilder().setContent(Content.newBuilder()
                .addParts(Part.newBuilder().setThought(true).setInlineData(Blob.getDefaultInstance()))
                .addParts(Part.newBuilder().setText("Generated image"))
                .addParts(Part.newBuilder().setInlineData(image)))).build();
        when(client.generateContent(any(GenerateContentRequest.class))).thenReturn(response, GenerateContentResponse.getDefaultInstance());
        assertEquals(image, GenerateMemoryPlant.generateGeminiImage(client, model, "garden"));

        var captor = ArgumentCaptor.forClass(GenerateContentRequest.class);
        verify(client).generateContent(captor.capture());
        GenerateContentRequest request = captor.getValue();
        assertEquals("projects/demo-test/locations/global/publishers/google/models/gemini-3.1-flash-image", request.getModel());
        assertEquals("garden", request.getContents(0).getParts(0).getText());
        assertEquals(List.of(GenerationConfig.Modality.TEXT, GenerationConfig.Modality.IMAGE),
            request.getGenerationConfig().getResponseModalitiesList());
        assertThrows(IOException.class, () -> GenerateMemoryPlant.generateGeminiImage(client, model, "filtered"));
    }
}
