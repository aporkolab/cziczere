package com.cziczere.functions;

import com.google.cloud.storage.Blob;
import com.google.cloud.storage.BlobInfo;
import com.google.cloud.storage.Storage;
import com.google.cloud.storage.StorageException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

final class MediaStorage {
    private static final String TOKEN_KEY = "firebaseStorageDownloadTokens";

    private MediaStorage() {}

    static String upload(Storage storage, BlobInfo info, byte[] data) {
        if (Boolean.parseBoolean(System.getenv("FIREBASE_MEDIA_LINKS"))) {
            return uploadFirebase(storage, info, data);
        }
        storage.create(info, data);
        return "https://storage.googleapis.com/" + info.getBucket() + "/" + encode(info.getName());
    }

    static String uploadFirebase(Storage storage, BlobInfo info, byte[] data) {
        Blob previous = null;
        for (int attempt = 1; ; attempt++) {
            Map<String, String> metadata = new HashMap<>();
            if (info.getMetadata() != null) metadata.putAll(info.getMetadata());
            String tokens = previous != null && previous.getMetadata() != null
                ? previous.getMetadata().get(TOKEN_KEY) : null;
            if (tokens == null || tokens.isBlank()) tokens = UUID.randomUUID().toString();
            metadata.put(TOKEN_KEY, tokens);

            // Images get unique names. Regenerating the same audio must keep earlier links usable.
            Storage.BlobTargetOption[] preconditions = previous == null
                ? new Storage.BlobTargetOption[] {Storage.BlobTargetOption.doesNotExist()}
                : new Storage.BlobTargetOption[] {Storage.BlobTargetOption.generationMatch(previous.getGeneration()),
                    Storage.BlobTargetOption.metagenerationMatch(previous.getMetageneration())};
            try {
                storage.create(info.toBuilder().setMetadata(metadata).build(), data, preconditions);
                return "https://firebasestorage.googleapis.com/v0/b/" + info.getBucket() + "/o/"
                    + encode(info.getName()) + "?alt=media&token=" + encode(tokens.split(",", 2)[0].trim());
            } catch (StorageException conflict) {
                if (conflict.getCode() != 412 || attempt == 4) throw conflict;
                previous = storage.get(info.getBlobId());
            }
        }
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
    }
}
