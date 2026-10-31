package com.cziczere.functions;

import com.google.cloud.functions.HttpFunction;
import com.google.cloud.functions.HttpRequest;
import com.google.cloud.functions.HttpResponse;

import java.util.HashMap;
import java.util.Map;

/** Serves the garden's HTTP functions on one port in the local Compose installation. */
public final class LocalApi implements HttpFunction {
    private final Map<String, HttpFunction> handlers = new HashMap<>();

    @Override
    public void service(HttpRequest request, HttpResponse response) throws Exception {
        String path = request.getPath();
        if ("/healthz".equals(path) && "GET".equals(request.getMethod())) {
            response.setStatusCode(200);
            return;
        }

        HttpFunction handler = handlerFor(path);
        if (handler == null) {
            response.setStatusCode(404);
            return;
        }
        handler.service(request, response);
    }

    // Each handler owns cloud clients. Initialize once on first use and allow failed
    // construction to be retried without serializing concurrent requests to the handler.
    private synchronized HttpFunction handlerFor(String path) throws Exception {
        HttpFunction handler = handlers.get(path);
        if (handler == null) {
            handler = switch (path) {
                case "/api/generateMemoryPlant" -> new GenerateMemoryPlant();
                case "/api/analyzeMemories" -> new AnalyzeMemories();
                case "/api/getAtmosphere" -> new GetAtmosphere();
                case "/api/exportGarden" -> new ExportGarden();
                case "/api/getInsightAudio" -> new GetInsightAudio();
                case "/api/poeticRephrasing" -> new PoeticRephrasing();
                default -> null;
            };
            if (handler != null) {
                handlers.put(path, handler);
            }
        }
        return handler;
    }
}
