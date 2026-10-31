package com.cziczere.functions;

import com.google.cloud.storage.Blob;
import com.google.cloud.storage.BlobInfo;
import com.google.cloud.storage.Storage;
import com.google.cloud.storage.StorageException;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class MediaStorageTest {
    private final Storage storage = mock(Storage.class);
    private final BlobInfo info = BlobInfo.newBuilder("demo-bucket", "folder/a b+.png").setContentType("image/png").build();
    private final byte[] bytes = {1, 2};

    @Test
    void privateObjectGetsEscapedUrlAndItsOwnDownloadToken() {
        String url = MediaStorage.uploadFirebase(storage, info, bytes);
        var uploaded = ArgumentCaptor.forClass(BlobInfo.class);
        verify(storage).create(uploaded.capture(), eq(bytes), eq(Storage.BlobTargetOption.doesNotExist()));
        String token = uploaded.getValue().getMetadata().get("firebaseStorageDownloadTokens");
        assertDoesNotThrow(() -> UUID.fromString(token));
        assertEquals("https://firebasestorage.googleapis.com/v0/b/demo-bucket/o/folder%2Fa%20b%2B.png?alt=media&token=" + token, url);
        assertEquals("image/png", uploaded.getValue().getContentType());
    }

    @Test
    void overwritingAudioPreservesTheExistingDownloadTokens() {
        var previous = mock(Blob.class);
        when(previous.getGeneration()).thenReturn(10L);
        when(previous.getMetageneration()).thenReturn(2L);
        when(previous.getMetadata()).thenReturn(Map.of("firebaseStorageDownloadTokens", "first,second"));
        when(storage.get(info.getBlobId())).thenReturn(previous);
        when(storage.create(any(BlobInfo.class), eq(bytes), eq(Storage.BlobTargetOption.doesNotExist())))
            .thenThrow(new StorageException(412, "object already exists"));

        assertTrue(MediaStorage.uploadFirebase(storage, info, bytes).endsWith("&token=first"));
        var uploaded = ArgumentCaptor.forClass(BlobInfo.class);
        verify(storage).create(uploaded.capture(), eq(bytes), eq(Storage.BlobTargetOption.generationMatch(10L)),
            eq(Storage.BlobTargetOption.metagenerationMatch(2L)));
        assertEquals("first,second", uploaded.getValue().getMetadata().get("firebaseStorageDownloadTokens"));
    }
}
