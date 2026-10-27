package in.roninwb.twa;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * RWB Track: shares the rider's live location the way WhatsApp live location does.
 * - A foreground service of type "location" with an ongoing notification (Android doesn't stop it with the screen off).
 * - Google's fused location provider (GPS + Wi-Fi + mobile network), fast while moving, slow when standing still.
 * - Its own background thread and a partial wake lock, so sending never waits for the screen or the app UI.
 * - Positions go straight to Supabase (track_ping_key) with a sharing key that works only while this rider shares.
 * - No signal: keeps the newest position and sends it as soon as the network is back.
 * The app reads its health (last GPS fix, last send, last error) through TrackPlugin.status().
 */
public class TrackService extends Service {
    static final String PREFS = "rwb_track", STATS = "rwb_track_stats";
    static final String CHANNEL = "rwb_track";
    static final int NOTIFICATION_ID = 7301;
    static volatile boolean running = false;

    private HandlerThread thread;
    private Handler handler;
    private PowerManager.WakeLock wakeLock;
    private FusedLocationProviderClient fused;
    private LocationManager lm;
    private boolean fast = true;
    private Location last, sent, lastMove;
    private long sentAt = 0, still = 0;
    private boolean sending = false;
    private String url, anon, key;
    private long until;

    public static void start(Context c, String url, String anon, String key, long until) {
        c.getSharedPreferences(PREFS, 0).edit().putString("url", url).putString("anon", anon).putString("key", key).putLong("until", until).apply();
        c.getSharedPreferences(STATS, 0).edit().clear().putLong("started", System.currentTimeMillis()).apply();
        Intent i = new Intent(c, TrackService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
    }

    public static void stop(Context c) {
        c.getSharedPreferences(PREFS, 0).edit().clear().apply();
        c.stopService(new Intent(c, TrackService.class));
    }

    private void stat(String k, long v) { getSharedPreferences(STATS, 0).edit().putLong(k, v).apply(); }
    private void stat(String k, String v) { getSharedPreferences(STATS, 0).edit().putString(k, v).apply(); }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences p = getSharedPreferences(PREFS, 0);
        url = p.getString("url", null); anon = p.getString("anon", null); key = p.getString("key", null); until = p.getLong("until", 0);
        if (!showNotification()) return START_NOT_STICKY;
        if (url == null || anon == null || key == null || until < System.currentTimeMillis()) { finish(); return START_NOT_STICKY; }
        if (!running) { running = true; begin(); }
        return START_REDELIVER_INTENT;
    }

    private boolean showNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Live location (Track)", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        int icon = getResources().getIdentifier("ic_stat_rwb", "drawable", getPackageName());
        if (icon == 0) icon = getApplicationInfo().icon;
        b.setSmallIcon(icon).setContentTitle("RWB is sharing your live location")
            .setContentText("Tap to open the RWB App. Stop sharing in Track.").setOngoing(true).setContentIntent(pi);
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, b.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            else startForeground(NOTIFICATION_ID, b.build());
            return true;
        } catch (Exception e) {   /* e.g. no location permission, or Android refused to start it from the background */
            stat("error", "start: " + e.getClass().getSimpleName() + " " + e.getMessage());
            running = false;
            stopSelf();
            return false;
        }
    }

    @SuppressLint("WakelockTimeout")
    private void begin() {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "rwb:track");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire(Math.max(60000L, until - System.currentTimeMillis() + 60000L));
        thread = new HandlerThread("rwb-track");
        thread.start();
        handler = new Handler(thread.getLooper());
        handler.post(() -> { requestUpdates(true); handler.postDelayed(tick, 15000L); });
    }

    /* fast: every 5–10 s while moving. slow: every 30–60 s while standing still (saves battery) */
    @SuppressLint("MissingPermission")
    private void requestUpdates(boolean wantFast) {
        fast = wantFast;
        try {
            if (fused == null) fused = LocationServices.getFusedLocationProviderClient(this);
            fused.removeLocationUpdates(fusedCb);
            LocationRequest req = new LocationRequest.Builder(wantFast ? Priority.PRIORITY_HIGH_ACCURACY : Priority.PRIORITY_BALANCED_POWER_ACCURACY, wantFast ? 8000L : 45000L)
                .setMinUpdateIntervalMillis(wantFast ? 4000L : 20000L).setWaitForAccurateLocation(false).build();
            fused.requestLocationUpdates(req, fusedCb, thread.getLooper());
            stat("provider", wantFast ? "fused-fast" : "fused-slow");
        } catch (Throwable t) {   /* no Google Play services: use the phone's GPS directly */
            try {
                if (lm == null) lm = (LocationManager) getSystemService(LOCATION_SERVICE);
                lm.removeUpdates(gpsCb);
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, wantFast ? 5000L : 30000L, 0f, gpsCb, thread.getLooper());
                try { lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 30000L, 0f, gpsCb, thread.getLooper()); } catch (Exception ignored) { }
                stat("provider", "gps");
            } catch (Exception e) { stat("error", "location: " + e.getMessage()); }
        }
    }

    private final LocationCallback fusedCb = new LocationCallback() {
        @Override public void onLocationResult(LocationResult r) { Location l = r.getLastLocation(); if (l != null) onFix(l); }
    };
    private final LocationListener gpsCb = new LocationListener() {
        @Override public void onLocationChanged(Location l) { onFix(l); }
        @Override public void onProviderEnabled(String p) { }
        @Override public void onProviderDisabled(String p) { }
        @Override public void onStatusChanged(String p, int s, Bundle b) { }
    };

    /* runs on the service's own thread */
    private void onFix(Location l) {
        if (last != null && "network".equals(l.getProvider()) && "gps".equals(last.getProvider()) && l.getTime() - last.getTime() < 60000L) return;
        last = l;
        long now = System.currentTimeMillis();
        stat("fix", now); stat("acc", (long) l.getAccuracy());
        /* moving or not: switch between fast and slow updates */
        if (lastMove == null || lastMove.distanceTo(l) > 40) { lastMove = l; still = now; if (!fast) requestUpdates(true); }
        else if (fast && now - still > 180000L) requestUpdates(false);
        long gap = now - sentAt;
        float moved = sent == null ? Float.MAX_VALUE : sent.distanceTo(l);
        long every = l.hasSpeed() && l.getSpeed() > 8 ? 10000L : 20000L;
        if ((moved >= 30 && gap >= every) || gap >= 60000L || (sent == null && l.getAccuracy() <= 150)) send(l);
    }

    /* heartbeat: the time limit, a position at least every minute, and retries after no signal */
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (System.currentTimeMillis() > until) { finish(); return; }
            if (last != null && System.currentTimeMillis() - sentAt >= 60000L) send(last);
            handler.postDelayed(this, 15000L);
        }
    };

    /* runs on the service's own thread (a few KB, once every 10–60 s) */
    private void send(Location l) {
        if (sending) return;
        sending = true; sent = l; sentAt = System.currentTimeMillis();
        HttpURLConnection c = null;
        try {
            JSONObject o = new JSONObject();
            o.put("p_key", key); o.put("p_lat", l.getLatitude()); o.put("p_lng", l.getLongitude());
            o.put("p_acc", l.hasAccuracy() ? (double) Math.round(l.getAccuracy()) : JSONObject.NULL);
            o.put("p_spd", l.hasSpeed() ? (double) l.getSpeed() : JSONObject.NULL);
            o.put("p_hdg", l.hasBearing() ? (double) l.getBearing() : JSONObject.NULL);
            c = (HttpURLConnection) new URL(url + "/rest/v1/rpc/track_ping_key").openConnection();
            c.setRequestMethod("POST"); c.setConnectTimeout(12000); c.setReadTimeout(12000); c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("apikey", anon); c.setRequestProperty("Authorization", "Bearer " + anon);
            try (OutputStream os = c.getOutputStream()) { os.write(o.toString().getBytes(StandardCharsets.UTF_8)); }
            int code = c.getResponseCode();
            StringBuilder sb = new StringBuilder();
            InputStream is = code < 400 ? c.getInputStream() : c.getErrorStream();
            if (is != null) try (BufferedReader r = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) { String s; while ((s = r.readLine()) != null && sb.length() < 400) sb.append(s); }
            stat("code", code);
            if (code < 300) {
                stat("sent", System.currentTimeMillis()); stat("error", "");
                if (sb.toString().contains("stopped")) { stat("error", "server: sharing stopped"); handler.post(this::finish); }
            } else { stat("error", "server " + code + ": " + sb); sentAt = 0; }
        } catch (Exception e) {
            stat("error", "network: " + e.getClass().getSimpleName()); sentAt = 0;   /* no signal: retry on the next fix or tick */
        } finally {
            if (c != null) c.disconnect();
            sending = false;
        }
    }

    private void finish() {
        running = false;
        getSharedPreferences(PREFS, 0).edit().clear().apply();
        cleanup();
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
        stopSelf();
    }

    private void cleanup() {
        try { if (fused != null) fused.removeLocationUpdates(fusedCb); } catch (Throwable ignored) { }
        try { if (lm != null) lm.removeUpdates(gpsCb); } catch (Exception ignored) { }
        if (handler != null) handler.removeCallbacksAndMessages(null);
        if (thread != null) thread.quitSafely();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    }

    @Override public void onDestroy() {
        running = false;
        cleanup();
        super.onDestroy();
    }
}
