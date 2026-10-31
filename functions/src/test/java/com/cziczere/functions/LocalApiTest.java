package com.cziczere.functions;

import com.google.cloud.functions.HttpRequest;
import com.google.cloud.functions.HttpResponse;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.*;

class LocalApiTest {
    private final LocalApi api = new LocalApi();
    private final HttpRequest request = mock(HttpRequest.class);
    private final HttpResponse response = mock(HttpResponse.class);

    @Test
    void healthCheckAndUnknownPathsDoNotRequireCloudClients() throws Exception {
        when(request.getMethod()).thenReturn("GET");
        when(request.getPath()).thenReturn("/healthz", "/api/missing", "/generateMemoryPlant");

        api.service(request, response);
        api.service(request, response);
        api.service(request, response);

        verify(response).setStatusCode(200);
        verify(response, times(2)).setStatusCode(404);
    }

    @Test
    void repeatedRequestsReachTheSameHandlerWithOriginalRequestAndResponse() throws Exception {
        when(request.getPath()).thenReturn("/api/getAtmosphere");
        try (var constructors = mockConstruction(GetAtmosphere.class)) {
            api.service(request, response);
            api.service(request, response);

            assertEquals(1, constructors.constructed().size());
            verify(constructors.constructed().getFirst(), times(2)).service(request, response);
        }
    }
}
