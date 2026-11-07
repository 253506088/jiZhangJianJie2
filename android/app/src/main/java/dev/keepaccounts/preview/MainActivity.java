package dev.keepaccounts.preview;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LedgerStorePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
