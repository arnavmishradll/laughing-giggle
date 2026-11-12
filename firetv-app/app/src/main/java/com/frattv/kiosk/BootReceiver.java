package com.frattv.kiosk;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** Opens the TV page automatically when the Fire Stick turns on. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Intent i = new Intent(context, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        try { context.startActivity(i); } catch (Exception ignored) { }
        // keep watching, and retry in case the home screen loads on top of us
        Intent s = new Intent(context, KioskService.class).putExtra("boot", true);
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(s); else context.startService(s);
        } catch (Exception ignored) { }
    }
}
