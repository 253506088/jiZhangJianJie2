package dev.keepaccounts.preview;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FilterOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** User-initiated text export through the Storage Access Framework. No broad storage permission. */
@CapacitorPlugin(name = "LedgerFiles")
public class LedgerFilesPlugin extends Plugin {
    private static final long MAX_BYTES = 96L * 1024L * 1024L;
    private static final String STAGE_KEY = "_ledgerExportToken";
    private static final String TOKEN_PATTERN = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final AtomicBoolean active = new AtomicBoolean(false);

    @PluginMethod
    public void saveDocument(PluginCall call) {
        final String content = call.getString("content");
        final String fileName = call.getString("fileName");
        final String mimeType = call.getString("mimeType", "application/json");
        if (content == null || content.isEmpty() || content.length() > MAX_BYTES ||
                !safeFileName(fileName)) {
            call.reject("导出内容或文件名无效。", "EXPORT_ARGUMENTS");
            return;
        }
        if (!Arrays.asList("application/json", "application/octet-stream", "text/csv", "text/plain").contains(mimeType)) {
            call.reject("不支持这个导出文件类型。", "EXPORT_ARGUMENTS");
            return;
        }
        if (!active.compareAndSet(false, true)) {
            call.reject("另一份文件正在保存，请先完成或取消。", "EXPORT_BUSY");
            return;
        }
        // Activity state must never contain the full ledger: it exceeds Binder's saved-state limit.
        call.getData().remove("content");
        submit(call, () -> {
            File staged = null;
            try {
                File directory = exportDirectory();
                cleanupStaleFiles(directory);
                String token = UUID.randomUUID().toString();
                staged = stageFile(token);
                if (!staged.createNewFile()) throw new IOException("Staging collision");
                try (FileOutputStream file = new FileOutputStream(staged);
                     Writer writer = new OutputStreamWriter(new BoundedOutputStream(file), StandardCharsets.UTF_8)) {
                    writer.write(content);
                    writer.flush();
                    file.getFD().sync();
                }
                call.getData().put(STAGE_KEY, token);
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(mimeType);
                intent.putExtra(Intent.EXTRA_TITLE, fileName);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                bridge.executeOnMainThread(() -> {
                    try {
                        startActivityForResult(call, intent, "documentCreated");
                    } catch (Exception error) {
                        cleanup(call);
                        active.set(false);
                        call.reject("无法打开系统文件保存器，请重试。", "EXPORT_PICKER");
                    }
                });
            } catch (Exception error) {
                if (staged != null) staged.delete();
                active.set(false);
                call.reject("无法准备导出文件，请检查设备可用空间。", "EXPORT_STAGE");
            }
        });
    }

    @ActivityCallback
    private void documentCreated(PluginCall call, ActivityResult result) {
        if (call == null) {
            active.set(false);
            return;
        }
        // A callback can belong to a recreated plugin instance after the file picker.
        active.set(true);
        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK) {
            cleanup(call);
            active.set(false);
            JSObject response = new JSObject();
            response.put("cancelled", true);
            call.resolve(response);
            return;
        }
        if (uri == null || !"content".equals(uri.getScheme())) {
            cleanup(call);
            active.set(false);
            call.reject("系统没有返回有效的保存位置。", "EXPORT_DESTINATION");
            return;
        }
        final Uri destination = uri;
        submit(call, () -> {
            try {
                File staged = stageFile(call.getString(STAGE_KEY));
                if (!staged.isFile() || staged.length() == 0 || staged.length() > MAX_BYTES)
                    throw new IOException("Staged export unavailable");
                MessageDigest sourceDigest = MessageDigest.getInstance("SHA-256");
                long written = 0;
                try (InputStream source = new FileInputStream(staged);
                     OutputStream output = getContext().getContentResolver().openOutputStream(destination, "wt")) {
                    if (output == null) throw new IOException("Destination unavailable");
                    byte[] buffer = new byte[32 * 1024];
                    int count;
                    while ((count = source.read(buffer)) != -1) {
                        output.write(buffer, 0, count);
                        sourceDigest.update(buffer, 0, count);
                        written += count;
                    }
                    output.flush();
                }
                // Do not claim success merely because the provider accepted a write request.
                MessageDigest savedDigest = MessageDigest.getInstance("SHA-256");
                long readBack = 0;
                try (InputStream saved = getContext().getContentResolver().openInputStream(destination)) {
                    if (saved == null) throw new IOException("Readback unavailable");
                    byte[] buffer = new byte[32 * 1024];
                    int count;
                    while ((count = saved.read(buffer)) != -1) {
                        readBack += count;
                        if (readBack > MAX_BYTES) throw new IOException("Readback too large");
                        savedDigest.update(buffer, 0, count);
                    }
                }
                if (written != staged.length() || readBack != written ||
                        !MessageDigest.isEqual(sourceDigest.digest(), savedDigest.digest()))
                    throw new IOException("Readback mismatch");
                JSObject response = new JSObject();
                response.put("cancelled", false);
                call.resolve(response);
            } catch (Exception error) {
                // Leave any unverified output visible to the user; never delete an arbitrary provider URI.
                call.reject("文件写出或校验未完成。请保留原账本并重新导出。", "EXPORT_WRITE");
            } finally {
                cleanup(call);
                active.set(false);
            }
        });
    }

    private File exportDirectory() throws IOException {
        File cache = getContext().getCacheDir().getCanonicalFile();
        File directory = new File(cache, "ledger-document-exports");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("No staging directory");
        if (!directory.getCanonicalPath().startsWith(cache.getPath() + File.separator))
            throw new IOException("Invalid staging directory");
        return directory;
    }

    private void submit(PluginCall call, Runnable work) {
        try {
            io.execute(work);
        } catch (RuntimeException error) {
            cleanup(call);
            active.set(false);
            call.reject("导出已中断，请重新打开应用后重试。", "EXPORT_INTERRUPTED");
        }
    }

    private static boolean safeFileName(String name) {
        if (name == null || name.trim().isEmpty() || name.length() > 180) return false;
        for (int index = 0; index < name.length(); index++) {
            char value = name.charAt(index);
            if (Character.isISOControl(value) || "\\/:*?\"<>|".indexOf(value) >= 0) return false;
        }
        return true;
    }

    private File stageFile(String token) throws IOException {
        if (token == null || !token.matches(TOKEN_PATTERN)) throw new IOException("Invalid staging token");
        return new File(exportDirectory(), "backup-" + token + ".tmp");
    }

    private void cleanup(PluginCall call) {
        try {
            stageFile(call.getString(STAGE_KEY)).delete();
        } catch (Exception ignored) {
            // A future export removes only this plugin's old temporary files; no paths or content are logged.
        }
        call.getData().remove(STAGE_KEY);
    }

    private static void cleanupStaleFiles(File directory) {
        File[] files = directory.listFiles();
        if (files == null) return;
        long before = System.currentTimeMillis() - 24L * 60L * 60L * 1000L;
        for (File file : files) {
            if (file.isFile() && file.getName().matches("backup-" + TOKEN_PATTERN + "\\.tmp") &&
                    file.lastModified() < before) file.delete();
        }
    }

    private static final class BoundedOutputStream extends FilterOutputStream {
        private long bytes = 0;

        BoundedOutputStream(OutputStream output) { super(output); }

        @Override
        public void write(int value) throws IOException {
            if (++bytes > MAX_BYTES) throw new IOException("Export size limit");
            out.write(value);
        }

        @Override
        public void write(byte[] buffer, int offset, int count) throws IOException {
            if (count > MAX_BYTES - bytes) throw new IOException("Export size limit");
            out.write(buffer, offset, count);
            bytes += count;
        }
    }

    @Override
    protected void handleOnDestroy() {
        // Let an already-started write finish; never interrupt midway through an output document.
        io.shutdown();
    }
}
