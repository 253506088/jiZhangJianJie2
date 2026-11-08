package dev.keepaccounts.jianjie2;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LedgerStorePlugin.class);
        registerPlugin(LedgerFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
