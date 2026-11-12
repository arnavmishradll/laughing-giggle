package com.frattv.kiosk;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Opens the TV page automatically when the Fire Stick turns on. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Intent i = new Intent(context, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        context.startActivity(i);
    }
}
