package com.cziczere.functions;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.cloud.functions.HttpRequest;
import com.google.cloud.vertexai.VertexAI;
import com.google.cloud.functions.HttpResponse;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseAuthException;
import com.google.firebase.auth.FirebaseToken;
import com.google.gson.Gson;

import java.io.IOException;
import java.util.Arrays;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.logging.Level;
import java.util.logging.Logger;
import java.util.stream.Collectors;

/**
 * Shared plumbing for the HTTP functions: configuration, Firebase initialization,
 * ID token verification and JSON error bodies.
 */
final class FunctionSupport {

    private static final Logger logger = Logger.getLogger(FunctionSupport.class.getName());
    private static final Gson gson = new Gson();
    private static final String BEARER_PREFIX = "Bearer ";

    static final String PROJECT_ID = env("GCP_PROJECT_ID", "your-gcp-project-id");
    static final String REGION = env("GCP_REGION", "us-central1");
    static final String GEMINI_MODEL = env("GEMINI_MODEL", "gemini-2.5-flash");
    /** Image publisher model: Compose uses Gemini; older deployments can continue to select Imagen. */
    static final String IMAGEN_MODEL = env("IMAGEN_MODEL", "imagen-3.0-generate-002");
    /** Comma-separated CORS allowlist, e.g. {@code https://cziczere-ai.web.app}. */
    static final Set<String> ALLOWED_ORIGINS = parseOrigins(System.getenv("ALLOWED_ORIGINS"));

    private FunctionSupport() {
    }

    static String vertexHost(String location) {
        return switch (location) {
            case "global" -> "aiplatform.googleapis.com";
            case "us", "eu" -> "aiplatform." + location + ".rep.googleapis.com";
            default -> location + "-aiplatform.googleapis.com";
        };
    }

    static VertexAI vertexAI() {
        return new VertexAI.Builder().setProjectId(PROJECT_ID).setLocation(REGION)
            .setApiEndpoint(vertexHost(REGION)).build();
    }

    static String env(String name, String defaultValue) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? defaultValue : value;
    }

    /** Initializes the default Firebase app once per JVM; safe to call from every function. */
    static synchronized void initFirebase() {
        if (!FirebaseApp.getApps().isEmpty()) {
            return;
        }
        try {
            FirebaseOptions options = FirebaseOptions.builder()
                .setCredentials(GoogleCredentials.getApplicationDefault())
                .setProjectId(PROJECT_ID)
                .build();
            FirebaseApp.initializeApp(options);
            logger.info("Firebase Admin SDK initialized successfully.");
        } catch (IOException e) {
            logger.log(Level.SEVERE, "Firebase Admin SDK initialization failed.", e);
        }
    }

    /**
     * Verifies the Firebase ID token from the {@code Authorization: Bearer} header.
     *
     * @return the authenticated user's UID
     */
    static String requireUserId(HttpRequest request, FirebaseAuth firebaseAuth) throws AuthException {
        Optional<String> authHeader = request.getFirstHeader("Authorization");
        if (authHeader.isEmpty() || !authHeader.get().startsWith(BEARER_PREFIX)) {
            throw new AuthException("Authorization header is missing or not Bearer type.");
        }
        String idToken = authHeader.get().substring(BEARER_PREFIX.length()).trim();
        if (idToken.isEmpty()) {
            throw new AuthException("Bearer token is empty.");
        }
        try {
            FirebaseToken decodedToken = firebaseAuth.verifyIdToken(idToken);
            return decodedToken.getUid();
        } catch (FirebaseAuthException | IllegalArgumentException e) {
            throw new AuthException("Invalid Firebase ID token: " + e.getMessage());
        }
    }

    /**
     * Adds CORS headers and answers preflight requests.
     *
     * <p>{@code ALLOWED_ORIGINS} is a comma-separated allowlist; when it is unset every
     * origin is allowed, which suits local development only. Auth uses bearer tokens,
     * not cookies, so credentials are never allowed.
     *
     * @return true when the request was an OPTIONS preflight and has been fully answered
     */
    static boolean handleCors(HttpRequest request, HttpResponse response, String allowedMethods) {
        String allowedOrigin = resolveAllowedOrigin(request.getFirstHeader("Origin").orElse(null), ALLOWED_ORIGINS);
        if (allowedOrigin != null) {
            response.appendHeader("Access-Control-Allow-Origin", allowedOrigin);
            if (!"*".equals(allowedOrigin)) {
                response.appendHeader("Vary", "Origin");
            }
        }
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            response.appendHeader("Access-Control-Allow-Methods", allowedMethods + ", OPTIONS");
            response.appendHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
            response.appendHeader("Access-Control-Max-Age", "3600");
            response.setStatusCode(204);
            return true;
        }
        return false;
    }

    static String resolveAllowedOrigin(String origin, Set<String> allowedOrigins) {
        if (allowedOrigins.isEmpty()) {
            return "*";
        }
        return origin != null && allowedOrigins.contains(origin) ? origin : null;
    }

    private static Set<String> parseOrigins(String value) {
        if (value == null || value.isBlank()) {
            return Set.of();
        }
        return Arrays.stream(value.split(","))
            .map(String::trim)
            .filter(s -> !s.isEmpty())
            .collect(Collectors.toUnmodifiableSet());
    }

    /** Serializes {@code {"error": message}} with proper escaping. */
    static String errorJson(String message) {
        return gson.toJson(Map.of("error", message));
    }

    /**
     * Extracts the outermost JSON object from a model response, tolerating Markdown
     * code fences or surrounding prose.
     *
     * @return the JSON object text, or empty if the response holds no braces
     */
    static Optional<String> extractJsonObject(String text) {
        if (text == null) {
            return Optional.empty();
        }
        int start = text.indexOf('{');
        int end = text.lastIndexOf('}');
        if (start < 0 || end <= start) {
            return Optional.empty();
        }
        return Optional.of(text.substring(start, end + 1));
    }

    static class AuthException extends Exception {
        AuthException(String message) {
            super(message);
        }
    }
}
