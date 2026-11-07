package dev.keepaccounts.preview;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Private SQLite snapshots. No storage permission and no exported provider are required. */
@CapacitorPlugin(name = "LedgerStore")
public class LedgerStorePlugin extends Plugin {
    private Store helper;

    private synchronized Store store() {
        if (helper == null) helper = new Store(getContext().getApplicationContext());
        return helper;
    }

    @PluginMethod
    public synchronized void read(PluginCall call) {
        try {
            JSObject result = new JSObject();
            JSObject snapshot = readCurrent(store().getReadableDatabase());
            result.put("snapshot", snapshot == null ? JSONObject.NULL : snapshot);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("无法读取本地账本。数据未被删除。", "STORAGE_READ");
        }
    }

    @PluginMethod
    public synchronized void history(PluginCall call) {
        try {
            JSArray snapshots = new JSArray();
            try (Cursor cursor = store().getReadableDatabase().query(
                    "history", null, null, null, null, null, "revision DESC")) {
                while (cursor.moveToNext()) snapshots.put(fromCursor(cursor));
            }
            JSObject result = new JSObject();
            result.put("snapshots", snapshots);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("无法读取历史保存点。", "STORAGE_READ");
        }
    }

    @PluginMethod
    public synchronized void write(PluginCall call) {
        JSObject snapshot = call.getObject("snapshot");
        Integer expected = call.getInt("expectedRevision");
        if (snapshot == null || expected == null || expected < 0 || expected >= Integer.MAX_VALUE - 1) {
            call.reject("保存参数无效。", "STORAGE_ARGUMENTS");
            return;
        }
        int revision = snapshot.optInt("revision", -1);
        String data = snapshot.optString("data", "");
        String checksum = snapshot.optString("sha256", "");
        String savedAt = snapshot.optString("savedAt", "");
        try {
            byte[] bytes = data.getBytes(StandardCharsets.UTF_8);
            if (revision != expected + 1 || bytes.length > 64 * 1024 * 1024 ||
                    data.isEmpty() || savedAt.isEmpty() || !checksum.equals(sha256(bytes))) {
                call.reject("保存校验未通过，原账本未更改。", "STORAGE_INTEGRITY");
                return;
            }
            SQLiteDatabase database = store().getWritableDatabase();
            boolean conflict = false;
            database.beginTransaction();
            try {
                JSObject previous = readCurrent(database);
                int actual = previous == null ? 0 : previous.optInt("revision");
                if (actual != expected) {
                    conflict = true;
                } else {
                    if (previous != null) database.insertOrThrow("history", null, values(previous, false));
                    long written = database.insertWithOnConflict("current_snapshot", null, values(snapshot, true), SQLiteDatabase.CONFLICT_REPLACE);
                    if (written == -1) throw new IllegalStateException("Snapshot write failed");
                    database.execSQL("DELETE FROM history WHERE revision NOT IN (SELECT revision FROM history ORDER BY revision DESC LIMIT 3)");
                    database.setTransactionSuccessful();
                }
            } finally {
                database.endTransaction();
            }
            if (conflict) call.reject("账本已更新，请重新载入。", "REVISION_CONFLICT");
            else call.resolve();
        } catch (Exception error) {
            call.reject("本地保存失败，请检查设备可用空间。原账本已保留。", "STORAGE_WRITE");
        }
    }

    private static ContentValues values(JSObject snapshot, boolean current) {
        ContentValues values = new ContentValues();
        if (current) values.put("slot", 1);
        values.put("revision", snapshot.optInt("revision"));
        values.put("saved_at", snapshot.optString("savedAt"));
        values.put("data", snapshot.optString("data"));
        values.put("sha256", snapshot.optString("sha256"));
        return values;
    }

    private static JSObject readCurrent(SQLiteDatabase database) throws Exception {
        try (Cursor cursor = database.query("current_snapshot", null, "slot = 1", null, null, null, null)) {
            return cursor.moveToFirst() ? fromCursor(cursor) : null;
        }
    }

    private static JSObject fromCursor(Cursor cursor) throws Exception {
        JSObject result = new JSObject();
        result.put("revision", cursor.getInt(cursor.getColumnIndexOrThrow("revision")));
        result.put("savedAt", cursor.getString(cursor.getColumnIndexOrThrow("saved_at")));
        result.put("data", cursor.getString(cursor.getColumnIndexOrThrow("data")));
        result.put("sha256", cursor.getString(cursor.getColumnIndexOrThrow("sha256")));
        return result;
    }

    private static String sha256(byte[] bytes) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder text = new StringBuilder(64);
        for (byte value : digest) text.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
        return text.toString();
    }

    @Override
    protected synchronized void handleOnDestroy() {
        if (helper != null) {
            helper.close();
            helper = null;
        }
    }

    private static class Store extends SQLiteOpenHelper {
        Store(Context context) {
            super(context, "jizhang-v1.db", null, 1);
            setWriteAheadLoggingEnabled(true);
        }

        @Override
        public void onConfigure(SQLiteDatabase database) {
            database.execSQL("PRAGMA synchronous=FULL");
        }

        @Override
        public void onCreate(SQLiteDatabase database) {
            database.execSQL("CREATE TABLE current_snapshot (slot INTEGER PRIMARY KEY CHECK(slot=1), revision INTEGER NOT NULL, saved_at TEXT NOT NULL, data TEXT NOT NULL, sha256 TEXT NOT NULL)");
            database.execSQL("CREATE TABLE history (revision INTEGER PRIMARY KEY, saved_at TEXT NOT NULL, data TEXT NOT NULL, sha256 TEXT NOT NULL)");
        }

        @Override
        public void onUpgrade(SQLiteDatabase database, int oldVersion, int newVersion) {
            // Never use a destructive fallback migration for a personal ledger.
            throw new IllegalStateException("Unsupported ledger database version");
        }
    }
}
