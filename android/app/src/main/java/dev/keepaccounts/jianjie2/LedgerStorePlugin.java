package dev.keepaccounts.jianjie2;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.database.sqlite.SQLiteStatement;
import android.os.ParcelFileDescriptor;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Private SQLite snapshots. Large payloads never pass through CursorWindow. */
@CapacitorPlugin(name = "LedgerStore")
public class LedgerStorePlugin extends Plugin {
    private static final int MAX_BYTES = 64 * 1024 * 1024;
    private Store helper;
    private synchronized Store store() {
        if (helper == null) helper = new Store(getContext().getApplicationContext());
        return helper;
    }

    @PluginMethod
    public synchronized void read(PluginCall call) {
        try {
            JSObject snapshot = readSnapshot(store().getReadableDatabase(), null);
            JSObject result = new JSObject();
            result.put("snapshot", snapshot == null ? JSONObject.NULL : snapshot);
            call.resolve(result);
        } catch (Exception error) { call.reject("无法读取本地账本。数据未被删除。", "STORAGE_READ"); }
    }

    @PluginMethod
    public synchronized void historyHeaders(PluginCall call) {
        try {
            JSArray headers = new JSArray();
            try (Cursor cursor = store().getReadableDatabase().rawQuery(
                    "SELECT revision,saved_at,sha256,length(CAST(data AS BLOB)) AS bytes FROM history ORDER BY revision DESC", null)) {
                while (cursor.moveToNext()) headers.put(header(cursor));
            }
            JSObject result = new JSObject(); result.put("headers", headers); call.resolve(result);
        } catch (Exception error) { call.reject("无法读取历史保存点。", "STORAGE_READ"); }
    }

    @PluginMethod
    public synchronized void readHistory(PluginCall call) {
        Integer revision = call.getInt("revision");
        if (revision == null || revision < 1) { call.reject("保存点版本无效。", "STORAGE_ARGUMENTS"); return; }
        try {
            JSObject snapshot = readSnapshot(store().getReadableDatabase(), revision);
            JSObject result = new JSObject();
            result.put("snapshot", snapshot == null ? JSONObject.NULL : snapshot);
            call.resolve(result);
        } catch (Exception error) { call.reject("这个保存点无法读取，其他版本仍保留。", "STORAGE_READ"); }
    }

    // Retained for the old bundled client during development upgrades; new UI loads one point at a time.
    @PluginMethod
    public synchronized void history(PluginCall call) {
        try {
            SQLiteDatabase database = store().getReadableDatabase();
            java.util.ArrayList<Integer> revisions = new java.util.ArrayList<>();
            long total = 0;
            try (Cursor cursor = database.rawQuery("SELECT revision,length(CAST(data AS BLOB)) FROM history ORDER BY revision DESC", null)) {
                while (cursor.moveToNext()) { revisions.add(cursor.getInt(0)); total += cursor.getLong(1); }
            }
            if (total > MAX_BYTES) { call.reject("历史数据较大，请使用按保存点恢复。", "HISTORY_PAGING_REQUIRED"); return; }
            JSArray snapshots = new JSArray();
            for (Integer revision : revisions) snapshots.put(readSnapshot(database, revision));
            JSObject result = new JSObject(); result.put("snapshots", snapshots); call.resolve(result);
        } catch (Exception error) { call.reject("无法读取历史保存点。", "STORAGE_READ"); }
    }

    @PluginMethod
    public synchronized void write(PluginCall call) {
        JSObject snapshot = call.getObject("snapshot");
        Integer expected = call.getInt("expectedRevision");
        if (snapshot == null || expected == null || expected < 0 || expected >= Integer.MAX_VALUE - 1) {
            call.reject("保存参数无效。", "STORAGE_ARGUMENTS"); return;
        }
        int revision = snapshot.optInt("revision", -1);
        String data = snapshot.optString("data", "");
        String checksum = snapshot.optString("sha256", "");
        String savedAt = snapshot.optString("savedAt", "");
        try {
            byte[] bytes = data.getBytes(StandardCharsets.UTF_8);
            if (revision != expected + 1 || bytes.length > MAX_BYTES || data.isEmpty() ||
                    savedAt.isEmpty() || savedAt.length() > 64 || !checksum.equals(sha256(bytes))) {
                call.reject("保存校验未通过，原账本未更改。", "STORAGE_INTEGRITY"); return;
            }
            SQLiteDatabase database = store().getWritableDatabase();
            boolean conflict = false;
            database.beginTransaction();
            try {
                int actual = 0;
                try (Cursor cursor = database.rawQuery("SELECT revision FROM current_snapshot WHERE slot=1", null)) {
                    if (cursor.moveToFirst()) actual = cursor.getInt(0);
                }
                if (actual != expected) conflict = true;
                else {
                    // Copy inside SQLite: do not materialize a possibly large previous JSON in Java.
                    database.execSQL("INSERT INTO history(revision,saved_at,data,sha256) SELECT revision,saved_at,data,sha256 FROM current_snapshot WHERE slot=1");
                    try (SQLiteStatement statement = database.compileStatement(
                            "INSERT OR REPLACE INTO current_snapshot(slot,revision,saved_at,data,sha256) VALUES(1,?,?,?,?)")) {
                        statement.bindLong(1, revision); statement.bindString(2, savedAt);
                        statement.bindString(3, data); statement.bindString(4, checksum);
                        if (statement.executeInsert() == -1) throw new IllegalStateException("Snapshot write failed");
                    }
                    database.execSQL("DELETE FROM history WHERE revision NOT IN (SELECT revision FROM history ORDER BY revision DESC LIMIT 3)");
                    database.setTransactionSuccessful();
                }
            } finally { database.endTransaction(); }
            if (conflict) call.reject("账本已更新，请重新载入。", "REVISION_CONFLICT");
            else call.resolve();
        } catch (Exception error) { call.reject("本地保存失败，请检查设备可用空间。原账本已保留。", "STORAGE_WRITE"); }
    }

    private static JSObject header(Cursor cursor) throws Exception {
        long length = cursor.getLong(cursor.getColumnIndexOrThrow("bytes"));
        if (length < 0 || length > MAX_BYTES) throw new IllegalStateException("Snapshot length invalid");
        JSObject result = new JSObject();
        result.put("revision", cursor.getInt(cursor.getColumnIndexOrThrow("revision")));
        result.put("savedAt", cursor.getString(cursor.getColumnIndexOrThrow("saved_at")));
        result.put("sha256", cursor.getString(cursor.getColumnIndexOrThrow("sha256")));
        result.put("bytes", length);
        return result;
    }

    private static JSObject readSnapshot(SQLiteDatabase database, Integer revision) throws Exception {
        boolean transaction = !database.inTransaction() && !database.isReadOnly();
        if (transaction) database.beginTransactionNonExclusive();
        try {
            String table = revision == null ? "current_snapshot" : "history";
            String where = revision == null ? "slot=1" : "revision=?";
            String[] arguments = revision == null ? null : new String[]{String.valueOf(revision)};
            JSObject result;
            try (Cursor cursor = database.rawQuery(
                    "SELECT revision,saved_at,sha256,length(CAST(data AS BLOB)) AS bytes FROM " + table + " WHERE " + where, arguments)) {
                if (!cursor.moveToFirst()) {
                    if (transaction) database.setTransactionSuccessful();
                    return null;
                }
                result = header(cursor);
            }
            int size = result.optInt("bytes", -1);
            if (size < 0) throw new IllegalStateException("Snapshot size invalid");
            byte[] bytes = new byte[size];
            try (SQLiteStatement statement = database.compileStatement("SELECT CAST(data AS BLOB) FROM " + table + " WHERE " + where)) {
                if (revision != null) statement.bindLong(1, revision);
                ParcelFileDescriptor descriptor = statement.simpleQueryForBlobFileDescriptor();
                if (descriptor == null) throw new IllegalStateException("Snapshot payload missing");
                try (InputStream input = new ParcelFileDescriptor.AutoCloseInputStream(descriptor)) {
                    int offset = 0;
                    while (offset < bytes.length) {
                        int read = input.read(bytes, offset, bytes.length - offset);
                        if (read < 0) throw new IllegalStateException("Incomplete snapshot");
                        offset += read;
                    }
                }
            }
            String data = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
            result.remove("bytes");
            result.put("data", data);
            if (transaction) database.setTransactionSuccessful();
            return result;
        } finally { if (transaction) database.endTransaction(); }
    }

    private static String sha256(byte[] bytes) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder text = new StringBuilder(64);
        for (byte value : digest) text.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
        return text.toString();
    }

    @Override
    protected synchronized void handleOnDestroy() {
        if (helper != null) { helper.close(); helper = null; }
    }

    private static class Store extends SQLiteOpenHelper {
        Store(Context context) {
            super(context, "jizhang-v1.db", null, 1);
            setWriteAheadLoggingEnabled(true);
        }
        @Override public void onConfigure(SQLiteDatabase database) { database.execSQL("PRAGMA synchronous=FULL"); }
        @Override public void onCreate(SQLiteDatabase database) {
            database.execSQL("CREATE TABLE current_snapshot (slot INTEGER PRIMARY KEY CHECK(slot=1), revision INTEGER NOT NULL, saved_at TEXT NOT NULL, data TEXT NOT NULL, sha256 TEXT NOT NULL)");
            database.execSQL("CREATE TABLE history (revision INTEGER PRIMARY KEY, saved_at TEXT NOT NULL, data TEXT NOT NULL, sha256 TEXT NOT NULL)");
        }
        @Override public void onUpgrade(SQLiteDatabase database, int oldVersion, int newVersion) {
            throw new IllegalStateException("Unsupported ledger database version");
        }
    }
}
