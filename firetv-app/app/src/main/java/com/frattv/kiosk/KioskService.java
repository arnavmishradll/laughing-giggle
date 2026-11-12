package com.frattv.kiosk;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.AlarmManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.os.PowerManager;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

/**
 * Runs quietly in the background and puts House TV back on screen
 * whenever the Fire Stick wakes from sleep or finishes booting.
 */
public class KioskService extends Service {
    private static final String CHANNEL = "kiosk";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private BroadcastReceiver wakeReceiver;
    private static final long CHECK_MS = 3 * 60 * 1000; // check every 3 minutes

    public static void start(Context c) {
        Intent i = new Intent(c, KioskService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
        } catch (Exception ignored) { }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        goForeground();
        wakeReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent intent) { bringBackSoon(); }
        };
        IntentFilter f = new IntentFilter();
        f.addAction(Intent.ACTION_SCREEN_ON);
        f.addAction(Intent.ACTION_USER_PRESENT);
        f.addAction(Intent.ACTION_DREAMING_STOPPED); // screensaver ended
        registerReceiver(wakeReceiver, f);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && intent.getBooleanExtra("boot", false)) bringBackSoon();
        if (intent != null && "check".equals(intent.getAction())) wakeIfAsleep();
        scheduleCheck();
        return START_STICKY;
    }

    /** The Fire TV home screen also loads right after waking, so try a few times. */
    private void bringBackSoon() {
        long[] delays = {1500, 6000, 20000, 60000};
        for (long d : delays) handler.postDelayed(new Runnable() { public void run() { bringBack(); } }, d);
    }

    private void bringBack() {
        if (MainActivity.isOnScreen) return;
        Intent i = new Intent(this, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        try { startActivity(i); } catch (Exception ignored) { }
    }

    /** If Fire TV put itself to sleep, turn the screen back on (this also triggers bringBackSoon via SCREEN_ON). */
    @SuppressWarnings("deprecation")
    private void wakeIfAsleep() {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm == null || pm.isInteractive()) return;
        try {
            PowerManager.WakeLock wl = pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK
                | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE, "frattv:wake");
            wl.acquire(15000);
        } catch (Exception ignored) { }
        bringBackSoon();
    }

    /** Alarm that fires even while the stick is asleep. */
    private void scheduleCheck() {
        AlarmManager am = (AlarmManager) getSystemService(ALARM_SERVICE);
        if (am == null) return;
        Intent i = new Intent(this, KioskService.class).setAction("check");
        PendingIntent pi;
        if (Build.VERSION.SDK_INT >= 26) pi = PendingIntent.getForegroundService(this, 7, i, PendingIntent.FLAG_UPDATE_CURRENT);
        else pi = PendingIntent.getService(this, 7, i, PendingIntent.FLAG_UPDATE_CURRENT);
        long at = System.currentTimeMillis() + CHECK_MS;
        if (Build.VERSION.SDK_INT >= 23) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        else am.setExact(AlarmManager.RTC_WAKEUP, at, pi);
    }

    private void goForeground() {
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "House TV", NotificationManager.IMPORTANCE_MIN));
            b = new Notification.Builder(this, CHANNEL);
        } else {
            b = new Notification.Builder(this);
        }
        Notification n = b.setContentTitle("House TV").setContentText("Keeping the house TV on screen")
            .setSmallIcon(R.mipmap.ic_launcher).build();
        startForeground(1, n);
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (wakeReceiver != null) unregisterReceiver(wakeReceiver);
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
